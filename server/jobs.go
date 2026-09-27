package server

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
	"github.com/fmotalleb/ffmpeg-web/probe"
	"github.com/fmotalleb/ffmpeg-web/storage"
)

// handleFfmpegLog tails the log file of one ffmpeg run, identified by the pid
// the queue and the hardware report already show. Only pids this server
// started are served: the log file lives in the private work directory and is
// named for the pid, so anything else is a miss, and the pid must have been
// seen running here (now, or since the last restart) — otherwise the endpoint
// would happily tail any pid a visitor types.
func (s *server) handleFfmpegLog(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 0 {
		writeErr(w, http.StatusBadRequest, "bad pid")
		return
	}
	if !s.knownFFmpegPID(pid) {
		writeErr(w, http.StatusNotFound, "no log for that pid")
		return
	}
	path := filepath.Join(s.workDir, fmt.Sprintf("ffmpeg-%d.log", pid))
	f, err := os.Open(path)
	if err != nil {
		writeErr(w, http.StatusNotFound, "no log for that pid")
		return
	}
	defer f.Close()

	// Tail: the modal asks for the last N lines every second, so read at most
	// a bounded window from the end rather than the whole file.
	lines := 400
	if v := r.URL.Query().Get("lines"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 2000 {
			lines = n
		}
	}
	data, err := tailFile(f, int64(lines)*400)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "cannot read the log")
		return
	}
	text := string(data)
	trimmed := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(trimmed) > lines {
		trimmed = trimmed[len(trimmed)-lines:]
	}
	writeJSON(w, http.StatusOK, map[string]any{"pid": pid, "lines": trimmed})
}

// knownFFmpegPID checks the pid was started by this server. A live pid in the
// queue counts, and so does a log file from this boot whose job is already
// finished — those are the files the cleanup has not got to yet.
func (s *server) knownFFmpegPID(pid int) bool {
	for _, id := range s.jobs.FfmpegPIDs() {
		if id == pid {
			return true
		}
	}
	// A finished run's file must be younger than the server process, so a
	// stale file left by an earlier boot is not resurrected for a recycled pid.
	info, err := os.Stat(filepath.Join(s.workDir, fmt.Sprintf("ffmpeg-%d.log", pid)))
	if err != nil {
		return false
	}
	return info.ModTime().After(processStart)
}

// tailFile returns the last maxBytes of an open file, aligned to a line start.
func tailFile(f *os.File, maxBytes int64) ([]byte, error) {
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	size := st.Size()
	if size == 0 {
		return []byte{}, nil
	}
	window := maxBytes
	if window > size {
		window = size
	}
	data := make([]byte, window)
	if _, err := f.ReadAt(data, size-window); err != nil {
		return nil, err
	}
	if window < size { // drop the partial line at the start of the window
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			data = data[i+1:]
		}
	}
	return data, nil
}

func (s *server) handleListJobs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.jobs.List())
}

func (s *server) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var spec ffmpeg.Spec
	if err := decodeBody(r, &spec); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	source, err := s.allowedPath(spec.Input)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	st, err := os.Stat(source)
	if err != nil {
		writeErr(w, http.StatusNotFound, "source file is gone")
		return
	}
	spec.Container = ffmpeg.NormalizeContainer(spec.Container)
	spec.Input = source
	if err := s.resolveExtraTracks(&spec); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}

	if _, err := ffmpeg.BuildArgs(spec, source, "preview.mp4", "", 0); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := probe.Probe(r.Context(), s.ffprobe, source)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	base := sanitizeName(spec.OutputName)
	if base == "source.bin" || base == "" {
		base = sanitizeName(info.Name)
	}
	base = strings.TrimSuffix(base, filepath.Ext(base))
	var output string
	if spec.MoveInPlace {
		// The result takes the source's place: same folder, same name, with the
		// chosen container deciding the extension. A rename onto the source
		// itself is the point here, not a mistake to reject.
		output = filepath.Join(filepath.Dir(source), base+"."+spec.Container)
		if output != source {
			output = uniquePath(output)
		}
	} else {
		output = uniquePath(filepath.Join(s.outDir, base+"."+spec.Container))
		if output == source {
			writeErr(w, http.StatusConflict, "the output would overwrite the source")
			return
		}
	}

	job := s.jobs.Add(spec, source, output, filepath.Base(source), "", info.Duration, float64(st.Size()))
	snapshot, _ := s.jobs.Get(job.ID)
	writeJSON(w, http.StatusAccepted, snapshot)
}

type batchRequest struct {
	Dir              string      `json:"dir"`
	Recursive        bool        `json:"recursive"`
	SkipExisting     bool        `json:"skipExisting"`
	IncludeTopFolder bool        `json:"includeTopFolder"`
	Spec             ffmpeg.Spec `json:"spec"`
}

// handleBatch queues every video under a folder, rebuilding the same folder
// tree underneath the output directory.
func (s *server) handleBatch(w http.ResponseWriter, r *http.Request) {
	var req batchRequest
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	dir, err := s.allowedPath(req.Dir)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		writeErr(w, http.StatusBadRequest, "that is not a folder")
		return
	}

	spec := req.Spec
	spec.Container = ffmpeg.NormalizeContainer(spec.Container)
	if err := s.resolveExtraTracks(&spec); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	if _, err := ffmpeg.BuildArgs(spec, "in.mkv", "out.mp4", "", 0); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	files, err := s.scanDir(dir, req.Recursive)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(files) == 0 {
		writeErr(w, http.StatusUnprocessableEntity, "no videos found in that folder")
		return
	}

	prefix := ""
	if req.IncludeTopFolder && dir != s.mediaRoot {
		prefix = filepath.Base(dir)
	}
	batchID := s.jobs.NewID("b")

	queued, skipped := 0, 0
	for _, f := range files {
		relDir := filepath.Dir(filepath.FromSlash(f.Rel))
		if relDir == "." {
			relDir = ""
		}
		stem := strings.TrimSuffix(filepath.Base(f.Path), filepath.Ext(f.Path))
		targetDir := filepath.Join(s.outDir, prefix, relDir)
		target := filepath.Join(targetDir, sanitizeName(stem)+"."+spec.Container)

		switch {
		case spec.MoveInPlace:
			// Each file is replaced where it lies, so the folder tree is kept by
			// definition and there is no existing file to skip.
			targetDir = filepath.Dir(f.Path)
			target = filepath.Join(targetDir, sanitizeName(stem)+"."+spec.Container)
			if target != f.Path {
				target = uniquePath(target)
			}
		case target == f.Path:
			skipped++
			continue
		case req.SkipExisting:
			if _, err := os.Stat(target); err == nil {
				skipped++
				continue
			}
		default:
			target = uniquePath(target)
		}
		if err := os.MkdirAll(targetDir, 0o755); err != nil {
			writeErr(w, http.StatusInternalServerError, "cannot create "+targetDir+": "+err.Error())
			return
		}

		jobSpec := spec
		jobSpec.Input = f.Path
		jobSpec.OutputName = stem
		label := f.Rel
		if prefix != "" {
			label = filepath.ToSlash(filepath.Join(prefix, f.Rel))
		}
		// Duration is left at zero: the worker probes each file when it starts,
		// so queueing a thousand files does not block on a thousand ffprobes.
		s.jobs.Add(jobSpec, f.Path, target, label, batchID, 0, float64(f.Size))
		queued++
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"batchId": batchID, "queued": queued, "skipped": skipped, "scanned": len(files),
	})
}

// handlePreview renders the exact ffmpeg command a spec would produce, so the
// Advanced tab shows the real thing rather than a guess.
func (s *server) handlePreview(w http.ResponseWriter, r *http.Request) {
	var spec ffmpeg.Spec
	if err := decodeBody(r, &spec); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	spec.Container = ffmpeg.NormalizeContainer(spec.Container)
	input := spec.Input
	if input == "" {
		input = filepath.Join(s.mediaRoot, "source.mkv")
	}
	stem := strings.TrimSuffix(sanitizeName(spec.OutputName), filepath.Ext(spec.OutputName))
	if stem == "" || stem == "source.bin" {
		stem = "output"
	}
	output := filepath.Join(s.outDir, stem+"."+spec.Container)
	if spec.MoveInPlace && input != "" {
		output = filepath.Join(filepath.Dir(input), stem+"."+spec.Container)
	}

	args, err := ffmpeg.BuildArgs(spec, input, output, filepath.Join(s.workDir, "preview"), 0)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"bin": s.ffmpeg, "args": args})
}

func uniquePath(p string) string {
	if _, err := os.Stat(p); errors.Is(err, os.ErrNotExist) {
		return p
	}
	ext := filepath.Ext(p)
	stem := strings.TrimSuffix(p, ext)
	for i := 1; i < 10000; i++ {
		candidate := fmt.Sprintf("%s (%d)%s", stem, i, ext)
		if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
			return candidate
		}
	}
	return fmt.Sprintf("%s-%d%s", stem, time.Now().Unix(), ext)
}

func (s *server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobs.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	writeJSON(w, http.StatusOK, job)
}

// handleUpdateJob changes a job's settings. The source file cannot be changed
// this way — only what will be done to it — and a running job must be
// cancelled first.
func (s *server) handleUpdateJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, ok := s.jobs.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	if existing.Status == storage.StatusRunning {
		writeErr(w, http.StatusConflict, "cannot edit a job while it's encoding — cancel it first")
		return
	}

	var spec ffmpeg.Spec
	if err := decodeBody(r, &spec); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	spec.Container = ffmpeg.NormalizeContainer(spec.Container)
	spec.Input = existing.Source
	if err := s.resolveExtraTracks(&spec); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}

	if _, err := ffmpeg.BuildArgs(spec, existing.Source, "preview."+spec.Container, "", 0); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	dir := filepath.Dir(existing.Output)
	stem := strings.TrimSuffix(sanitizeName(spec.OutputName), filepath.Ext(spec.OutputName))
	if stem == "" || stem == "source.bin" {
		stem = strings.TrimSuffix(filepath.Base(existing.Output), filepath.Ext(existing.Output))
	}
	var output string
	if spec.MoveInPlace {
		// Beside the source, under the source's own name.
		stem = strings.TrimSuffix(filepath.Base(existing.Source), filepath.Ext(existing.Source))
		output = filepath.Join(filepath.Dir(existing.Source), stem+"."+spec.Container)
		if output != existing.Source {
			output = uniquePath(output)
		}
	} else {
		output = filepath.Join(dir, stem+"."+spec.Container)
		if output != existing.Output {
			output = uniquePath(output)
		}
		if output == existing.Source {
			writeErr(w, http.StatusConflict, "the output would overwrite the source")
			return
		}
	}

	if err := s.jobs.UpdateJob(id, spec, output); err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	updated, _ := s.jobs.Get(id)
	writeJSON(w, http.StatusOK, updated)
}

func (s *server) handleJobLog(w http.ResponseWriter, r *http.Request) {
	lines := s.jobs.Logs(r.PathValue("id"))
	if lines == nil {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lines": lines})
}

func (s *server) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	if !s.jobs.Cancel(r.PathValue("id")) {
		writeErr(w, http.StatusConflict, "that job is already finished")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleRetryJob(w http.ResponseWriter, r *http.Request) {
	if err := s.jobs.Retry(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleMoveJob(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Delta int    `json:"delta"`
		To    string `json:"to"` // "top"
	}
	_ = decodeBody(r, &body)
	delta := body.Delta
	if body.To == "top" {
		delta = 0
	}
	if !s.jobs.Move(r.PathValue("id"), delta) {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleDeleteSource(w http.ResponseWriter, r *http.Request) {
	err := s.jobs.DeleteSource(r.PathValue("id"), func(p string) error {
		_, err := s.allowedPath(p)
		return err
	})
	if err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleMoveInPlace replaces a finished job's source with its encoded result.
// Only files the sandbox already knows are touched: the result comes from the
// output folder and the source from an allowed one.
func (s *server) handleMoveInPlace(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	job, ok := s.jobs.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	if err := s.outputAccessible(job.Output); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	if _, err := s.allowedPath(job.Source); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	if err := s.jobs.MoveInPlace(id); err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	if !s.jobs.Remove(r.PathValue("id")) {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleDownload(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobs.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	if job.Status != storage.StatusDone {
		writeErr(w, http.StatusConflict, "this encode has not finished")
		return
	}
	if err := s.outputAccessible(job.Output); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	f, err := os.Open(job.Output)
	if err != nil {
		writeErr(w, http.StatusNotFound, "the encoded file has been moved or deleted")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	name := filepath.Base(job.Output)
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	http.ServeContent(w, r, name, st.ModTime(), f)
}
