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

// The details view shows the command ffmpeg was handed, so the endpoint has to
// hand back the real thing: the job's own paths, the seek, the trim length in
// its output position, and the output file last.
func TestJobCommandReportsTheRealCommand(t *testing.T) {
	s := testJobServer(t)
	source := filepath.Join(s.mediaRoot, "input.mkv")
	output := filepath.Join(s.outDir, "result.mkv")
	spec := ffmpeg.Spec{
		Container: "mkv",
		Video:     ffmpeg.VideoSpec{Encoder: "copy"},
		Audio:     ffmpeg.AudioSpec{Encoder: "none"},
		Trim:      ffmpeg.TrimSpec{Enabled: true, Start: 10, End: 25},
	}
	job := s.jobs.Add(spec, source, output, "", "", 0, 0)

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/jobs/"+job.ID+"/command", nil)
	r.SetPathValue("id", job.ID)
	w := httptest.NewRecorder()
	s.handleJobCommand(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("command failed: %d %s", w.Code, w.Body.String())
	}
	var got struct {
		Bin  string   `json:"bin"`
		Args []string `json:"args"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	lastInput := -1
	trim := -1
	for i, a := range got.Args {
		switch a {
		case "-i":
			lastInput = i
		case "-t":
			trim = i
		}
	}
	if lastInput < 0 {
		t.Fatalf("no input in %v", got.Args)
	}
	if got.Args[lastInput+1] != source {
		t.Fatalf("input = %q, want %q", got.Args[lastInput+1], source)
	}
	if lastInput < 2 || got.Args[lastInput-2] != "-ss" || got.Args[lastInput-1] != "10" {
		t.Fatalf("missing the seek to the trim start: %v", got.Args)
	}
	if trim < lastInput || got.Args[trim+1] != "15" {
		t.Fatalf("trim length is not an output option: %v", got.Args)
	}
	if last := got.Args[len(got.Args)-1]; last != output {
		t.Fatalf("output = %q, want %q last", last, output)
	}
}

func TestJobCommandUnknownJob(t *testing.T) {
	s := testJobServer(t)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/jobs/nope/command", nil)
	r.SetPathValue("id", "nope")
	w := httptest.NewRecorder()
	s.handleJobCommand(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown job answered %d, want 404", w.Code)
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
