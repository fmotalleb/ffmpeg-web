package server

import (
	"encoding/json"
	"fmt"
	"io"
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

func writeImage(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

func writeVideo(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

func parseTimeWidth(r *http.Request) (float64, int) {
	t, _ := strconv.ParseFloat(r.URL.Query().Get("time"), 64)
	width := 0
	if v := r.URL.Query().Get("width"); v != "" {
		width, _ = strconv.Atoi(v)
	}
	return t, width
}

// handleFrame returns a raw frame from any file inside the allowed folders —
// used for the untouched source side of the compare tool.
func (s *server) handleFrame(w http.ResponseWriter, r *http.Request) {
	path, err := s.allowedPath(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	t, width := parseTimeWidth(r)
	data, err := s.frames.Get(path, t, width, "", func() ([]byte, error) {
		return ffmpeg.ExtractFrame(r.Context(), s.ffmpeg, path, t, width)
	})
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeImage(w, data)
}

// handlePreviewFrame renders a frame with a spec's filters applied, for the
// "target" side of the compare tool before any job exists yet.
func (s *server) handlePreviewFrame(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Input string      `json:"input"`
		Time  float64     `json:"time"`
		Width int         `json:"width"`
		Spec  ffmpeg.Spec `json:"spec"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	path, err := s.allowedPath(body.Input)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	specBytes, _ := json.Marshal(body.Spec)
	cacheKey := string(specBytes)
	data, err := s.frames.Get(path, body.Time, body.Width, cacheKey, func() ([]byte, error) {
		return ffmpeg.EncodePreviewFrame(r.Context(), s.ffmpeg, path, body.Time, body.Width, body.Spec, s.workDir)
	})
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeImage(w, data)
}

// ---- clip handlers ----

func parseTimeDur(r *http.Request) (float64, float64) {
	t, _ := strconv.ParseFloat(r.URL.Query().Get("time"), 64)
	dur := ffmpeg.DefaultClipDur
	if v := r.URL.Query().Get("duration"); v != "" {
		if parsed, err := strconv.ParseFloat(v, 64); err == nil && parsed > 0 {
			dur = parsed
		}
	}
	return t, dur
}

// handleClip returns a short MP4 clip from the source file at the given time.
func (s *server) handleClip(w http.ResponseWriter, r *http.Request) {
	path, err := s.allowedPath(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	t, dur := parseTimeDur(r)
	width := 0
	if v := r.URL.Query().Get("width"); v != "" {
		width, _ = strconv.Atoi(v)
	}
	data, err := ffmpeg.ExtractClip(r.Context(), s.ffmpeg, s.ffprobe, path, t, dur, width)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeVideo(w, data)
}

// handlePreviewClip returns a short MP4 clip encoded with the full spec.
func (s *server) handlePreviewClip(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Input    string      `json:"input"`
		Time     float64     `json:"time"`
		Duration float64     `json:"duration"`
		Spec     ffmpeg.Spec `json:"spec"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	path, err := s.allowedPath(body.Input)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	dur := body.Duration
	if dur <= 0 {
		dur = ffmpeg.DefaultClipDur
	}
	data, err := ffmpeg.EncodePreviewClip(r.Context(), s.ffmpeg, s.ffprobe, path, body.Time, dur, body.Spec, s.workDir)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeVideo(w, data)
}

// handleJobClip returns a clip from a job's source or output.
func (s *server) handleJobClip(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobs.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	t, dur := parseTimeDur(r)
	width := 0
	if v := r.URL.Query().Get("width"); v != "" {
		width, _ = strconv.Atoi(v)
	}

	path := job.Source
	if r.URL.Query().Get("which") == "output" {
		if job.Status != storage.StatusDone {
			writeErr(w, http.StatusConflict, "this job hasn't finished encoding yet")
			return
		}
		if err := s.outputAccessible(job.Output); err != nil {
			writeErr(w, http.StatusForbidden, err.Error())
			return
		}
		path = job.Output
	} else if _, err := s.allowedPath(path); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}

	data, err := ffmpeg.ExtractClip(r.Context(), s.ffmpeg, s.ffprobe, path, t, dur, width)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeVideo(w, data)
}

// handleJobFrame serves a frame from a job's source, or from its actual
// finished output — the real encoded bytes, not an approximation.
func (s *server) handleJobFrame(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobs.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	t, width := parseTimeWidth(r)

	path := job.Source
	if r.URL.Query().Get("which") == "output" {
		if job.Status != storage.StatusDone {
			writeErr(w, http.StatusConflict, "this job hasn't finished encoding yet — use the live preview instead")
			return
		}
		if err := s.outputAccessible(job.Output); err != nil {
			writeErr(w, http.StatusForbidden, err.Error())
			return
		}
		path = job.Output
	}

	data, err := s.frames.Get(path, t, width, "", func() ([]byte, error) {
		return ffmpeg.ExtractFrame(r.Context(), s.ffmpeg, path, t, width)
	})
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeImage(w, data)
}

// handleJobPreviewFrame renders a frame using a job's saved settings, so a
// queued or still-running job can be previewed before it finishes.
func (s *server) handleJobPreviewFrame(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobs.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	t, width := parseTimeWidth(r)
	specBytes, _ := json.Marshal(job.Spec)
	cacheKey := string(specBytes)
	data, err := s.frames.Get(job.Source, t, width, cacheKey, func() ([]byte, error) {
		return ffmpeg.EncodePreviewFrame(r.Context(), s.ffmpeg, job.Source, t, width, job.Spec, s.workDir)
	})
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeImage(w, data)
}

func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.maxUpload)
	src, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "no file in the upload")
		return
	}
	defer src.Close()

	name := sanitizeName(header.Filename)
	dst := filepath.Join(s.uploadDir, fmt.Sprintf("%d-%s", time.Now().UnixNano(), name))
	f, err := os.Create(dst)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "cannot write the upload: "+err.Error())
		return
	}
	if _, err := io.Copy(f, src); err != nil {
		f.Close()
		os.Remove(dst)
		writeErr(w, http.StatusInternalServerError, "upload interrupted: "+err.Error())
		return
	}
	f.Close()

	info, err := probe.Probe(r.Context(), s.ffprobe, dst)
	if err != nil {
		os.Remove(dst)
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func sanitizeName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, `\`, "/"))
	name = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case strings.ContainsRune(" ._-()[]", r):
			return r
		}
		return '_'
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return "source.bin"
	}
	if len(name) > 120 {
		name = name[len(name)-120:]
	}
	return name
}
