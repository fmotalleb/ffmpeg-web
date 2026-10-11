package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
	"github.com/fmotalleb/ffmpeg-web/storage"
	"github.com/fmotalleb/ffmpeg-web/system"
)

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
	var settings storage.QueueSettings
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
	snap.Version = storage.SnapshotVersion
	snap.SavedAt = time.Now()
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="queue-%s.json"`, time.Now().Format("2006-01-02-1504")))
	writeJSON(w, http.StatusOK, snap)
}

// handleImport adds jobs from an exported file. Every path is re-checked, and
// everything comes back as queued regardless of how it was exported.
func (s *server) handleImport(w http.ResponseWriter, r *http.Request) {
	var snap storage.Snapshot
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
		spec.Container = ffmpeg.NormalizeContainer(spec.Container)
		if err := s.resolveExtraTracks(&spec); err != nil {
			rejected = append(rejected, filepath.Base(source)+": "+err.Error())
			continue
		}
		if _, err := ffmpeg.BuildArgs(spec, source, "out.mp4", "", 0); err != nil {
			rejected = append(rejected, filepath.Base(source)+": "+err.Error())
			continue
		}

		stem := strings.TrimSuffix(sanitizeName(filepath.Base(source)), filepath.Ext(source))
		var output string
		if spec.MoveInPlace {
			output = filepath.Join(filepath.Dir(source), stem+"."+spec.Container)
			if output != source {
				output = uniquePath(output)
			}
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

// ---- presets ----

func (s *server) handlePresets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.presets.List())
}

type savePresetRequest struct {
	Name     string      `json:"name"`
	Group    string      `json:"group"`
	Note     string      `json:"note"`
	Settings ffmpeg.Spec `json:"settings"`
}

func (s *server) handleSavePreset(w http.ResponseWriter, r *http.Request) {
	var body savePresetRequest
	if err := decodeBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.presets.Save(body.Name, body.Group, body.Note, body.Settings); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.presets.List())
}

func (s *server) handleDeletePreset(w http.ResponseWriter, r *http.Request) {
	if err := s.presets.Delete(r.PathValue("name")); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.presets.List())
}

// ---- encoders ----

func (s *server) handleEncoders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"kinds":     ffmpeg.EncoderKinds,
		"libraries": ffmpeg.EncoderCatalog(),
	})
}

// ---- system ----

func (s *server) handleSystem(w http.ResponseWriter, r *http.Request) {
	// encodeLoad sums up the running jobs, so the popover can show the machine
	// being used rather than only its theoretical abilities.
	var encoding system.EncodeLoad
	for _, job := range s.jobs.Snapshot().Jobs {
		if job.Status != storage.StatusRunning {
			continue
		}
		encoding.Jobs++
		encoding.FPS += job.FPS
	}
	writeJSON(w, http.StatusOK,
		system.Collect(s.ffmpeg, s.monitor, s.jobs.FfmpegPIDs(), encoding))
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
