package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"go.uber.org/zap"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
	"github.com/fmotalleb/ffmpeg-web/jobs"
	"github.com/fmotalleb/ffmpeg-web/storage"
)

func testJobServer(t *testing.T) *server {
	t.Helper()
	dir := t.TempDir()
	manager := jobs.NewManager("", "", dir, jobs.NewBroker(), &storage.Store{}, nil, zap.NewNop())
	return &server{mediaRoot: dir, outDir: dir, jobs: manager}
}

func TestEditEmptyOutputName(t *testing.T) {
	s := testJobServer(t)
	output := filepath.Join(s.outDir, "current-name.mp4")
	spec := ffmpeg.Spec{Container: "mp4", Video: ffmpeg.VideoSpec{Encoder: "copy"}}
	job := s.jobs.Add(spec, filepath.Join(s.mediaRoot, "input.mkv"), output, "", "", 0, 0)
	body, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/jobs/"+job.ID, bytes.NewReader(body))
	r.SetPathValue("id", job.ID)
	w := httptest.NewRecorder()
	s.handleUpdateJob(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("edit failed: %d %s", w.Code, w.Body.String())
	}
	updated, _ := s.jobs.Get(job.ID)
	if updated.Output != output {
		t.Fatalf("empty name changed output to %q", updated.Output)
	}
}

func TestImportMoveInPlaceOutput(t *testing.T) {
	for _, sameContainer := range []bool{false, true} {
		t.Run(map[bool]string{false: "neighbor", true: "source"}[sameContainer], func(t *testing.T) {
			s := testJobServer(t)
			source := filepath.Join(s.mediaRoot, "input.mkv")
			neighbor := filepath.Join(s.mediaRoot, "input.mp4")
			for _, path := range []string{source, neighbor} {
				if err := os.WriteFile(path, []byte("keep"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			container, want := "mp4", filepath.Join(s.mediaRoot, "input (1).mp4")
			if sameContainer {
				container, want = "mkv", source
			}
			spec := ffmpeg.Spec{MoveInPlace: true, Container: container, Video: ffmpeg.VideoSpec{Encoder: "copy"}}
			body, err := json.Marshal(storage.Snapshot{Jobs: []storage.Job{{Source: source, Spec: spec}}})
			if err != nil {
				t.Fatal(err)
			}
			w := httptest.NewRecorder()
			s.handleImport(w, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/import", bytes.NewReader(body)))
			snap := s.jobs.Snapshot()
			if w.Code != http.StatusAccepted || len(snap.Jobs) != 1 {
				t.Fatalf("import failed: %d %s", w.Code, w.Body.String())
			}
			if snap.Jobs[0].Output != want {
				t.Fatalf("output = %q, want %q", snap.Jobs[0].Output, want)
			}
		})
	}
}
