// Package server serves the browser UI and its HTTP API. It is the only place
// that knows about routing: everything it needs from the queue, the encoders,
// the presets and the machine comes from the packages it imports.
package server

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fmotalleb/go-tools/log"
	"go.uber.org/zap"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
	"github.com/fmotalleb/ffmpeg-web/jobs"
	"github.com/fmotalleb/ffmpeg-web/storage"
	"github.com/fmotalleb/ffmpeg-web/system"
)

// processStart is when this server came up. A per-run ffmpeg log file older
// than this belongs to an earlier boot, so its pid must not be served — the
// OS may have given the same number to an unrelated process.
var processStart = time.Now()

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

// Config is everything the server needs to run. It is built once in main.
type Config struct {
	MediaRoot string
	OutDir    string
	UploadDir string
	WorkDir   string
	FFmpeg    string
	FFprobe   string
	Jobs      *jobs.Manager
	Broker    *jobs.Broker
	Store     *storage.Store
	Presets   *storage.PresetStore
	Frames    *ffmpeg.FrameCache
	Monitor   *system.Monitor
	Assets    fs.FS
	Log       *zap.Logger
	MaxUpload int64
	AllowCmds bool
	AuthUser  string
	AuthPass  string
}

type server struct {
	mediaRoot string
	outDir    string
	uploadDir string
	workDir   string
	ffmpeg    string
	ffprobe   string
	jobs      *jobs.Manager
	broker    *jobs.Broker
	store     *storage.Store
	presets   *storage.PresetStore
	frames    *ffmpeg.FrameCache
	monitor   *system.Monitor
	assets    fs.FS
	log       *zap.Logger
	maxUpload int64
	allowCmds bool

	authUsername string
	authPassword string
}

// New builds a server from the wiring main set up.
func New(c Config) *server {
	return &server{
		mediaRoot: c.MediaRoot,
		outDir:    c.OutDir,
		uploadDir: c.UploadDir,
		workDir:   c.WorkDir,
		ffmpeg:    c.FFmpeg,
		ffprobe:   c.FFprobe,
		jobs:      c.Jobs,
		broker:    c.Broker,
		store:     c.Store,
		presets:   c.Presets,
		frames:    c.Frames,
		monitor:   c.Monitor,
		assets:    c.Assets,
		log:       c.Log,
		maxUpload: c.MaxUpload,
		allowCmds: c.AllowCmds,

		authUsername: c.AuthUser,
		authPassword: c.AuthPass,
	}
}

// Routes builds the whole HTTP surface, with logging and optional basic auth.
func (s *server) Routes() http.Handler {
	mux := http.NewServeMux()
	static, err := fs.Sub(s.assets, "web-dist")
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
	mux.HandleFunc("POST /api/ffmpeg/{pid}/kill", s.handleKillFfmpeg)
	mux.HandleFunc("POST /api/ffmpeg/kill-all", s.handleKillAllFfmpeg)

	mux.HandleFunc("GET /api/jobs", s.handleListJobs)
	mux.HandleFunc("POST /api/jobs", s.handleCreateJob)
	mux.HandleFunc("POST /api/batch", s.handleBatch)
	mux.HandleFunc("POST /api/preview", s.handlePreview)
	mux.HandleFunc("GET /api/frame", s.handleFrame)
	mux.HandleFunc("POST /api/preview/frame", s.handlePreviewFrame)
	mux.HandleFunc("GET /api/clip", s.handleClip)
	mux.HandleFunc("POST /api/preview/clip", s.handlePreviewClip)
	mux.HandleFunc("GET /api/jobs/{id}", s.handleGetJob)
	mux.HandleFunc("GET /api/jobs/{id}/command", s.handleJobCommand)
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
	mux.HandleFunc("POST /api/jobs/{id}/move-in-place", s.handleMoveInPlace)
	mux.HandleFunc("DELETE /api/jobs/{id}", s.handleDeleteJob)
	mux.HandleFunc("GET /api/jobs/{id}/file", s.handleDownload)

	mux.HandleFunc("GET /api/queue", s.handleQueueState)
	mux.HandleFunc("POST /api/queue/pause", s.handlePause)
	mux.HandleFunc("POST /api/queue/settings", s.handleSetSettings)
	mux.HandleFunc("GET /api/queue/export", s.handleExport)
	mux.HandleFunc("POST /api/queue/import", s.handleImport)

	mux.HandleFunc("GET /api/events", s.handleEvents)

	router := logRequests(mux)
	if s.authUsername != "" && s.authPassword != "" {
		router = basicAuth(s.authUsername, s.authPassword)(router)
	}

	return router
}

func basicAuth(username, password string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, pass, ok := r.BasicAuth()
			if !ok ||
				subtle.ConstantTimeCompare([]byte(user), []byte(username)) != 1 ||
				subtle.ConstantTimeCompare([]byte(pass), []byte(password)) != 1 {
				w.Header().Set("WWW-Authenticate", `Basic realm="Transcoder"`)
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
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
func (s *server) resolveExtraTracks(spec *ffmpeg.Spec) error {
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
