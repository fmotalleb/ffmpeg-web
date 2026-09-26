package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/fmotalleb/go-tools/git"
	"github.com/fmotalleb/go-tools/log"
	"github.com/fmotalleb/varg"
	"go.uber.org/zap"
)

//go:embed web-dist
var webAssets embed.FS

// processStart is when this server came up. A per-run ffmpeg log file older
// than this belongs to an earlier boot, so its pid must not be served — the
// OS may have given the same number to an unrelated process.
var processStart = time.Now()

var nullDevice = os.DevNull

var videoExt = map[string]bool{
	".mp4": true, ".mkv": true, ".mov": true, ".avi": true, ".webm": true,
	".m4v": true, ".mpg": true, ".mpeg": true, ".ts": true, ".m2ts": true,
	".wmv": true, ".flv": true, ".ogv": true, ".3gp": true, ".vob": true,
	".mts": true, ".rmvb": true, ".divx": true,
}

// audioExt and subtitleExt back the "add a track" pickers, which browse the
// same folders as the source picker but only list what they can use.
var audioExt = map[string]bool{
	".m4a": true, ".mp3": true, ".aac": true, ".ac3": true, ".eac3": true,
	".flac": true, ".ogg": true, ".oga": true, ".opus": true, ".wav": true,
	".wma": true, ".dts": true, ".mka": true, ".mp2": true, ".aiff": true,
}

var subtitleExt = map[string]bool{
	".srt": true, ".ass": true, ".ssa": true, ".vtt": true, ".sub": true,
	".sup": true, ".smi": true, ".idx": true, ".mks": true,
}

// extSetForKind maps the browser's ?kind= to the extensions it should list.
// An unknown or missing kind keeps the original video behavior.
func extSetForKind(kind string) map[string]bool {
	switch kind {
	case "audio":
		return audioExt
	case "subtitle":
		return subtitleExt
	}
	return videoExt
}

type server struct {
	mediaRoot string
	outDir    string
	uploadDir string
	workDir   string
	ffmpeg    string
	ffprobe   string
	jobs      *Manager
	broker    *Broker
	store     *Store
	presets   *presetStore
	frames    *frameCache
	monitor   *systemMonitor
	log       *zap.Logger
	maxUpload int64
	allowCmds bool
}

func main() {
	logger := log.
		NewBuilder().
		FromEnv().
		InitialFields(map[string]any{
			"version": git.GetVersion(),
		}).
		MustBuild()
	ctx := log.WithLogger(
		context.Background(),
		logger,
	)
	args := varg.New("ffmpeg-web")
	args.Version(git.String())
	args.String("address", "a", "127.0.0.1:8723", "address to listen on").Env("LISTEN")
	args.String("root", "r", ".", "directory the browser is allowed to read sources from").Env("BASE_DIR")
	args.String("out", "o", "./encodes", "directory finished files are written to").Env("OUTPUT_DIR")
	args.String("queue", "q", "", "queue file (default: <out>/queue.json)").Env("QUEUE_FILE")
	args.String("ffmpeg", "", "ffmpeg", "path to the ffmpeg binary").Env("FFMPEG_PATH")
	args.String("ffprobe", "", "ffprobe", "path to the ffprobe binary").Env("FFPROBE_PATH")
	args.Uint64("max-upload", "", 16<<30, "largest accepted upload in bytes").Env("MAX_UPLOAD_SIZE")
	args.Bool("allow-commands", "", false, "let the post-queue action run a shell command").Env("ALLOW_COMMAND")
	must := func(err error) {
		if err != nil {
			logger.Fatal("startup failed", zap.Error(err))
		}
	}

	r := args.Handle(os.Args)
	if r.ShouldExit {
		must(r.Err)
		fmt.Println(r.Output)
		os.Exit(0)
	}
	cfg := r.Config

	addr := cfg.String("address")
	root := cfg.String("root")
	out := cfg.String("out")
	queueFile := cfg.String("queue")
	ffmpegBin := cfg.String("ffmpeg")
	ffprobeBin := cfg.String("ffprobe")
	maxUpload := cfg.Uint64("max-upload")
	allowCmds := cfg.Bool("allow-commands")

	mediaRoot, err := filepath.Abs(root)
	must(err)

	outDir, err := filepath.Abs(out)
	must(err)
	must(os.MkdirAll(outDir, 0o755))

	uploadDir := filepath.Join(outDir, ".uploads")
	workDir := filepath.Join(outDir, ".work")
	must(os.MkdirAll(uploadDir, 0o755))
	must(os.MkdirAll(workDir, 0o755))

	for _, bin := range []string{ffmpegBin, ffprobeBin} {
		if _, err := exec.LookPath(bin); err != nil {
			logger.Fatal("required binary not found on PATH — install ffmpeg, or pass -ffmpeg/-ffprobe",
				zap.String("binary", bin))
		}
	}

	probeEncoders(ffmpegBin)

	queuePath := queueFile
	if queuePath == "" {
		queuePath = filepath.Join(outDir, "queue.json")
	}
	store := NewStore(queuePath, logger.Named("store"))
	snap, err := store.Load()
	must(err)

	broker := NewBroker()
	hooks := &hookRunner{log: logger.Named("hooks"), allowCommands: allowCmds, outDir: outDir}
	manager := NewManager(ffmpegBin, ffprobeBin, workDir, broker, store, hooks, logger.Named("queue"))
	recovered := manager.Restore(snap)
	store.Start(manager.Snapshot)
	manager.Start()

	presetStore := newPresetStore(filepath.Join(outDir, "presets.json"), logger.Named("presets"))
	presetStore.load()

	srv := &server{
		mediaRoot: mediaRoot, outDir: outDir, uploadDir: uploadDir, workDir: workDir,
		ffmpeg: ffmpegBin, ffprobe: ffprobeBin,
		broker: broker, jobs: manager, store: store, presets: presetStore, frames: newFrameCache(256 << 20),
		log:       logger.Named("web"),
		monitor:   newSystemMonitor(),
		maxUpload: int64(maxUpload),
		allowCmds: allowCmds,
	}

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext: func(_ net.Listener) context.Context {
			return log.WithLogger(ctx, srv.log)
		},
	}

	go func() {
		logger.Info("ffmpeg-web", zap.String("version", git.String()))
		logger.Info("sources", zap.String("path", mediaRoot))
		logger.Info("encodes", zap.String("path", outDir))
		logger.Info("queue", zap.String("file", queuePath), zap.Int("jobs", len(snap.Jobs)))
		if recovered > 0 {
			logger.Info("recovered interrupted jobs — their partial output was deleted and they will run again",
				zap.Int("count", recovered))
		}
		logger.Info("listening", zap.String("addr", addr))
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("http server failed", zap.Error(err))
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down, saving the queue")
	// A frozen encode would outlive this server as a stopped process nothing
	// can wake any more, so let it run on like any other interrupted job.
	manager.thawFrozen()
	store.Flush()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	static, err := fs.Sub(webAssets, "web-dist")
	if err != nil { // cannot happen: the assets are embedded at build time
		panic(fmt.Errorf("cannot unpack embedded web assets: %w", err))
	}
	mux.Handle("GET /", http.FileServer(http.FS(static)))

	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("GET /api/browse", s.handleBrowse)
	mux.HandleFunc("GET /api/scan", s.handleScan)
	mux.HandleFunc("POST /api/probe", s.handleProbe)
	mux.HandleFunc("GET /api/probe/raw", s.handleProbeRaw)
	mux.HandleFunc("POST /api/upload", s.handleUpload)
	mux.HandleFunc("GET /api/presets", s.handlePresets)
	mux.HandleFunc("POST /api/presets", s.handleSavePreset)
	mux.HandleFunc("DELETE /api/presets/{name}", s.handleDeletePreset)
	mux.HandleFunc("GET /api/encoders", s.handleEncoders)
	mux.HandleFunc("GET /api/system", s.handleSystem)
	mux.HandleFunc("GET /api/ffmpeg/{pid}/log", s.handleFfmpegLog)

	mux.HandleFunc("GET /api/jobs", s.handleListJobs)
	mux.HandleFunc("POST /api/jobs", s.handleCreateJob)
	mux.HandleFunc("POST /api/batch", s.handleBatch)
	mux.HandleFunc("POST /api/preview", s.handlePreview)
	mux.HandleFunc("GET /api/frame", s.handleFrame)
	mux.HandleFunc("POST /api/preview/frame", s.handlePreviewFrame)
	mux.HandleFunc("GET /api/clip", s.handleClip)
	mux.HandleFunc("POST /api/preview/clip", s.handlePreviewClip)
	mux.HandleFunc("GET /api/jobs/{id}", s.handleGetJob)
	mux.HandleFunc("PUT /api/jobs/{id}", s.handleUpdateJob)
	mux.HandleFunc("GET /api/jobs/{id}/log", s.handleJobLog)
	mux.HandleFunc("GET /api/jobs/{id}/probe", s.handleJobProbe)
	mux.HandleFunc("GET /api/jobs/{id}/frame", s.handleJobFrame)
	mux.HandleFunc("GET /api/jobs/{id}/preview-frame", s.handleJobPreviewFrame)
	mux.HandleFunc("GET /api/jobs/{id}/clip", s.handleJobClip)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", s.handleCancelJob)
	mux.HandleFunc("POST /api/jobs/{id}/retry", s.handleRetryJob)
	mux.HandleFunc("POST /api/jobs/{id}/move", s.handleMoveJob)
	mux.HandleFunc("POST /api/jobs/{id}/delete-source", s.handleDeleteSource)
	mux.HandleFunc("DELETE /api/jobs/{id}", s.handleDeleteJob)
	mux.HandleFunc("GET /api/jobs/{id}/file", s.handleDownload)

	mux.HandleFunc("GET /api/queue", s.handleQueueState)
	mux.HandleFunc("POST /api/queue/pause", s.handlePause)
	mux.HandleFunc("POST /api/queue/settings", s.handleSetSettings)
	mux.HandleFunc("GET /api/queue/export", s.handleExport)
	mux.HandleFunc("POST /api/queue/import", s.handleImport)

	mux.HandleFunc("GET /api/events", s.handleEvents)

	return logRequests(mux)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/events" {
			log.Of(r.Context()).Info("request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path))
		}
		next.ServeHTTP(w, r)
	})
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func decodeBody(r *http.Request, v any) error {
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(v); err != nil {
		return errors.New("malformed request body")
	}
	return nil
}

// outputAccessible reports whether a finished file may be read back: it lives
// in the encodes folder, or — for a job that moved in place — right beside the
// source it replaced.
func (s *server) outputAccessible(p string) error {
	if s.insideOutput(p) == nil {
		return nil
	}
	_, err := s.allowedPath(p)
	return err
}

// resolveExtraTracks checks every added audio/subtitle file against the same
// sandbox as the source, and rewrites the paths to their absolute form so the
// worker never has to resolve them again.
func (s *server) resolveExtraTracks(spec *Spec) error {
	for i := range spec.Audio.Extra {
		if strings.TrimSpace(spec.Audio.Extra[i].Path) == "" {
			continue
		}
		p, err := s.allowedPath(spec.Audio.Extra[i].Path)
		if err != nil {
			return err
		}
		spec.Audio.Extra[i].Path = p
	}
	for i := range spec.Subtitle.Extra {
		if strings.TrimSpace(spec.Subtitle.Extra[i].Path) == "" {
			continue
		}
		p, err := s.allowedPath(spec.Subtitle.Extra[i].Path)
		if err != nil {
			return err
		}
		spec.Subtitle.Extra[i].Path = p
	}
	return nil
}

// allowedPath rejects anything outside the source root or the upload folder.
func (s *server) allowedPath(p string) (string, error) {
	if p == "" {
		return "", errors.New("no file given")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		abs = resolved
	}
	for _, root := range []string{s.mediaRoot, s.uploadDir} {
		rel, err := filepath.Rel(root, abs)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return abs, nil
		}
	}
	return "", fmt.Errorf("%s is outside the allowed folders", filepath.Base(abs))
}

func (s *server) insideOutput(p string) error {
	abs, err := filepath.Abs(p)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(s.outDir, filepath.Clean(abs))
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return errors.New("that file is outside the output folder")
	}
	return nil
}

// ---- config and browsing ----

func (s *server) handleConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"root":          s.mediaRoot,
		"outDir":        s.outDir,
		"separator":     string(os.PathSeparator),
		"allowCommands": s.allowCmds,
	})
}

type browseEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

func (s *server) handleBrowse(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("path")
	if target == "" {
		target = s.mediaRoot
	}
	dir, err := s.allowedPath(target)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "cannot open that folder: "+err.Error())
		return
	}
	allowedExt := extSetForKind(r.URL.Query().Get("kind"))

	list := []browseEntry{}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		full := filepath.Join(dir, name)
		if e.IsDir() {
			list = append(list, browseEntry{Name: name, Path: full, Dir: true})
			continue
		}
		if !allowedExt[strings.ToLower(filepath.Ext(name))] {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		list = append(list, browseEntry{Name: name, Path: full, Size: info.Size(), Mtime: info.ModTime().Unix()})
	}
	sort.Slice(list, func(a, b int) bool {
		if list[a].Dir != list[b].Dir {
			return list[a].Dir
		}
		return strings.ToLower(list[a].Name) < strings.ToLower(list[b].Name)
	})

	parent := ""
	if dir != s.mediaRoot {
		if p := filepath.Dir(dir); p != dir {
			if _, err := s.allowedPath(p); err == nil {
				parent = p
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": dir, "parent": parent, "entries": list})
}

type scanned struct {
	Path string `json:"path"`
	Rel  string `json:"rel"`
	Size int64  `json:"size"`
}

// scanDir finds the video files under dir, optionally walking subfolders.
func (s *server) scanDir(dir string, recursive bool) ([]scanned, error) {
	var found []scanned
	walk := func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			//nolint:nilerr // an unreadable corner should not abort the whole scan
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if path != dir && (strings.HasPrefix(name, ".") || !recursive) {
				return fs.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") || !videoExt[strings.ToLower(filepath.Ext(name))] {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			//nolint:nilerr // a file that vanished mid-scan is simply skipped
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			//nolint:nilerr // a file outside the walked tree is simply skipped
			return nil
		}
		found = append(found, scanned{Path: path, Rel: filepath.ToSlash(rel), Size: info.Size()})
		return nil
	}
	if err := filepath.WalkDir(dir, walk); err != nil {
		return nil, err
	}
	sort.Slice(found, func(a, b int) bool { return found[a].Rel < found[b].Rel })
	return found, nil
}

func (s *server) handleScan(w http.ResponseWriter, r *http.Request) {
	dir, err := s.allowedPath(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	recursive := r.URL.Query().Get("recursive") != "false"
	files, err := s.scanDir(dir, recursive)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var total int64
	for _, f := range files {
		total += f.Size
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path": dir, "count": len(files), "totalSize": total, "files": files,
	})
}

// ---- probing ----

func (s *server) handleProbe(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	path, err := s.allowedPath(body.Path)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	info, err := probe(r.Context(), s.ffprobe, path)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if info.Video == nil {
		writeErr(w, http.StatusUnprocessableEntity, "no video track in this file")
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// handleProbeRaw returns the complete ffprobe report for a source file.
func (s *server) handleProbeRaw(w http.ResponseWriter, r *http.Request) {
	path, err := s.allowedPath(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	s.serveRawProbe(w, r, path)
}

// handleJobProbe reports on either side of a job: ?which=source or output.
func (s *server) handleJobProbe(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobs.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	path := job.Source
	if r.URL.Query().Get("which") == "output" {
		path = job.Output
		if err := s.outputAccessible(path); err != nil {
			writeErr(w, http.StatusForbidden, err.Error())
			return
		}
	} else if _, err := s.allowedPath(path); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	s.serveRawProbe(w, r, path)
}

func (s *server) serveRawProbe(w http.ResponseWriter, r *http.Request, path string) {
	raw, err := probeRaw(r.Context(), s.ffprobe, path)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(raw)
}

// ---- single frames, for the compare/thumbnail tool ----

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
	data, err := s.cachedFrame(path, t, width, "", func() ([]byte, error) {
		return extractFrame(r.Context(), s.ffmpeg, path, t, width)
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
		Input string  `json:"input"`
		Time  float64 `json:"time"`
		Width int     `json:"width"`
		Spec  Spec    `json:"spec"`
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
	data, err := s.cachedFrame(path, body.Time, body.Width, cacheKey, func() ([]byte, error) {
		return encodePreviewFrame(r.Context(), s.ffmpeg, path, body.Time, body.Width, body.Spec, s.workDir)
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
	dur := defaultClipDur
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
	data, err := extractClip(r.Context(), s.ffmpeg, s.ffprobe, path, t, dur, width)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeVideo(w, data)
}

// handlePreviewClip returns a short MP4 clip encoded with the full spec.
func (s *server) handlePreviewClip(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Input    string  `json:"input"`
		Time     float64 `json:"time"`
		Duration float64 `json:"duration"`
		Spec     Spec    `json:"spec"`
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
		dur = defaultClipDur
	}
	data, err := encodePreviewClip(r.Context(), s.ffmpeg, s.ffprobe, path, body.Time, dur, body.Spec, s.workDir)
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
		if job.Status != StatusDone {
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

	data, err := extractClip(r.Context(), s.ffmpeg, s.ffprobe, path, t, dur, width)
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
		if job.Status != StatusDone {
			writeErr(w, http.StatusConflict, "this job hasn't finished encoding yet — use the live preview instead")
			return
		}
		if err := s.outputAccessible(job.Output); err != nil {
			writeErr(w, http.StatusForbidden, err.Error())
			return
		}
		path = job.Output
	}

	data, err := s.cachedFrame(path, t, width, "", func() ([]byte, error) {
		return extractFrame(r.Context(), s.ffmpeg, path, t, width)
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
	data, err := s.cachedFrame(job.Source, t, width, cacheKey, func() ([]byte, error) {
		return encodePreviewFrame(r.Context(), s.ffmpeg, job.Source, t, width, job.Spec, s.workDir)
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

	info, err := probe(r.Context(), s.ffprobe, dst)
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

func (s *server) handlePresets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.presets.list())
}

type savePresetRequest struct {
	Name     string `json:"name"`
	Group    string `json:"group"`
	Note     string `json:"note"`
	Settings Spec   `json:"settings"`
}

func (s *server) handleSavePreset(w http.ResponseWriter, r *http.Request) {
	var body savePresetRequest
	if err := decodeBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.presets.save(body.Name, body.Group, body.Note, body.Settings); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.presets.list())
}

func (s *server) handleDeletePreset(w http.ResponseWriter, r *http.Request) {
	if err := s.presets.delete(r.PathValue("name")); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.presets.list())
}

// ---- jobs ----

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
	for _, id := range s.jobs.ffmpegPIDs() {
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

func normalizeContainer(c string) string {
	switch c {
	case "mp4", "mkv", "webm":
		return c
	}
	return "mp4"
}

func (s *server) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var spec Spec
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
	spec.Container = normalizeContainer(spec.Container)
	spec.Input = source
	if err := s.resolveExtraTracks(&spec); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}

	if _, err := buildArgs(spec, source, "preview.mp4", "", 0); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	info, err := probe(r.Context(), s.ffprobe, source)
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
	Dir              string `json:"dir"`
	Recursive        bool   `json:"recursive"`
	SkipExisting     bool   `json:"skipExisting"`
	IncludeTopFolder bool   `json:"includeTopFolder"`
	Spec             Spec   `json:"spec"`
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
	spec.Container = normalizeContainer(spec.Container)
	if err := s.resolveExtraTracks(&spec); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	if _, err := buildArgs(spec, "in.mkv", "out.mp4", "", 0); err != nil {
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
	batchID := s.jobs.newID("b")

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
	var spec Spec
	if err := decodeBody(r, &spec); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	spec.Container = normalizeContainer(spec.Container)
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

	args, err := buildArgs(spec, input, output, filepath.Join(s.workDir, "preview"), 0)
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
	if existing.Status == StatusRunning {
		writeErr(w, http.StatusConflict, "cannot edit a job while it's encoding — cancel it first")
		return
	}

	var spec Spec
	if err := decodeBody(r, &spec); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	spec.Container = normalizeContainer(spec.Container)
	spec.Input = existing.Source
	if err := s.resolveExtraTracks(&spec); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}

	if _, err := buildArgs(spec, existing.Source, "preview."+spec.Container, "", 0); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	dir := filepath.Dir(existing.Output)
	stem := strings.TrimSuffix(sanitizeName(spec.OutputName), filepath.Ext(spec.OutputName))
	if stem == "" || stem == "source" {
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
	if job.Status != StatusDone {
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

// ---- queue control ----

func (s *server) handleQueueState(w http.ResponseWriter, r *http.Request) {
	snap := s.jobs.Snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"paused": snap.Paused, "settings": snap.Settings, "jobs": snap.Jobs,
		"allowCommands": s.allowCmds,
	})
}

func (s *server) handlePause(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paused bool `json:"paused"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.jobs.SetPaused(body.Paused)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSetSettings(w http.ResponseWriter, r *http.Request) {
	var settings QueueSettings
	if err := decodeBody(r, &settings); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if settings.PostQueue.Type == "command" && !s.allowCmds {
		writeErr(w, http.StatusForbidden,
			"running a command needs the server started with -allow-commands")
		return
	}
	s.jobs.SetSettings(settings)
	writeJSON(w, http.StatusOK, s.jobs.Settings())
}

func (s *server) handleExport(w http.ResponseWriter, r *http.Request) {
	snap := s.jobs.Snapshot()
	snap.Version = snapshotVersion
	snap.SavedAt = time.Now()
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="queue-%s.json"`, time.Now().Format("2006-01-02-1504")))
	writeJSON(w, http.StatusOK, snap)
}

// handleImport adds jobs from an exported file. Every path is re-checked, and
// everything comes back as queued regardless of how it was exported.
func (s *server) handleImport(w http.ResponseWriter, r *http.Request) {
	var snap Snapshot
	if err := decodeBody(r, &snap); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(snap.Jobs) == 0 {
		writeErr(w, http.StatusBadRequest, "that file has no jobs in it")
		return
	}

	added, rejected := 0, []string{}
	for _, job := range snap.Jobs {
		source, err := s.allowedPath(job.Source)
		if err != nil {
			rejected = append(rejected, filepath.Base(job.Source)+": "+err.Error())
			continue
		}
		st, err := os.Stat(source)
		if err != nil {
			rejected = append(rejected, filepath.Base(job.Source)+": file is gone")
			continue
		}
		spec := job.Spec
		spec.Input = source
		spec.Container = normalizeContainer(spec.Container)
		if err := s.resolveExtraTracks(&spec); err != nil {
			rejected = append(rejected, filepath.Base(source)+": "+err.Error())
			continue
		}
		if _, err := buildArgs(spec, source, "out.mp4", "", 0); err != nil {
			rejected = append(rejected, filepath.Base(source)+": "+err.Error())
			continue
		}

		stem := strings.TrimSuffix(sanitizeName(filepath.Base(source)), filepath.Ext(source))
		var output string
		if spec.MoveInPlace {
			output = filepath.Join(filepath.Dir(source), stem+"."+spec.Container)
		} else {
			output = job.Output
			if output == "" || s.insideOutput(output) != nil {
				output = filepath.Join(s.outDir, stem+"."+spec.Container)
			}
			output = uniquePath(output)
		}

		label := job.Label
		if label == "" {
			label = filepath.Base(source)
		}
		s.jobs.Add(spec, source, output, label, job.BatchID, job.Duration, float64(st.Size()))
		added++
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"added": added, "rejected": rejected})
}

// ---- events ----

func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming is not supported here")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch := s.broker.Subscribe()
	defer s.broker.Unsubscribe(ch)

	snap := s.jobs.Snapshot()
	if body, err := json.Marshal(map[string]any{
		"jobs": snap.Jobs, "paused": snap.Paused, "settings": snap.Settings,
	}); err == nil {
		fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", body)
		flusher.Flush()
	}

	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg, open := <-ch:
			if !open {
				return
			}
			if _, err := w.Write(msg); err != nil {
				return
			}
			flusher.Flush()
		case <-keepalive.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}
