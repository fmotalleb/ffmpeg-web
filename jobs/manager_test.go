package jobs

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sync"
	"testing"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
	"github.com/fmotalleb/ffmpeg-web/storage"
)

func TestNewIDConcurrent(t *testing.T) {
	m := &Manager{}
	const count = 1000
	ids := make(chan string, count)
	var wg sync.WaitGroup
	for i := range count {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if i%2 == 0 {
				m.mu.Lock()
				defer m.mu.Unlock()
			}
			ids <- m.NewID("j")
		}()
	}
	wg.Wait()
	close(ids)
	pattern := regexp.MustCompile(`^j[0-9]+-[0-9]+$`)
	seen := make(map[string]bool, count)
	for id := range ids {
		if !pattern.MatchString(id) || seen[id] {
			t.Fatalf("invalid or duplicate ID: %q", id)
		}
		seen[id] = true
	}
}

func TestUpdateJobRejectsDeletedSource(t *testing.T) {
	for _, status := range []storage.JobStatus{storage.StatusQueued, storage.StatusDone, storage.StatusFailed, storage.StatusCanceled} {
		t.Run(string(status), func(t *testing.T) {
			output := filepath.Join(t.TempDir(), "encoded.mp4")
			if err := os.WriteFile(output, []byte("keep result"), 0o600); err != nil {
				t.Fatal(err)
			}
			j := &storage.Job{ID: "j1", Status: status, Output: output, SourceDeleted: true, Progress: 1, Verified: true}
			before := j.Clone()
			m := &Manager{jobs: map[string]*storage.Job{j.ID: j}}
			if err := m.UpdateJob(j.ID, ffmpeg.Spec{Container: "mkv"}, output+".mkv"); err == nil {
				t.Fatal("editing a job without its source succeeded")
			}
			if !m.mu.TryLock() {
				t.Fatal("manager mutex was left locked")
			}
			m.mu.Unlock()
			if !reflect.DeepEqual(before, j.Clone()) {
				t.Fatal("rejected edit changed the job")
			}
			if data, err := os.ReadFile(output); err != nil || string(data) != "keep result" {
				t.Fatalf("rejected edit changed the output: %q, %v", data, err)
			}
		})
	}
}

func TestMoveInPlaceTargets(t *testing.T) {
	for _, kind := range []string{"existing", "symlink", "absent", "source"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			source := filepath.Join(dir, "source.mkv")
			output := filepath.Join(dir, "encoded.mp4")
			target := filepath.Join(dir, "source.mp4")
			if kind == "source" {
				source = target
			}
			for path, content := range map[string]string{source: "original", output: "encoded"} {
				if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			switch kind {
			case "existing":
				if err := os.WriteFile(target, []byte("neighbor"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Symlink(filepath.Join(dir, "missing"), target); err != nil {
					t.Fatal(err)
				}
			}
			j := &storage.Job{ID: "j1", Status: storage.StatusDone, Source: source, Output: output}
			m := &Manager{jobs: map[string]*storage.Job{j.ID: j}, store: &storage.Store{}, broker: NewBroker()}
			err := m.MoveInPlace(j.ID)
			if kind == "existing" || kind == "symlink" {
				if err == nil {
					t.Fatal("move replaced an existing target")
				}
				for path, want := range map[string]string{source: "original", output: "encoded"} {
					if data, readErr := os.ReadFile(path); readErr != nil || string(data) != want {
						t.Fatalf("move changed %s: %q, %v", path, data, readErr)
					}
				}
				if kind == "existing" {
					if data, readErr := os.ReadFile(target); readErr != nil || string(data) != "neighbor" {
						t.Fatalf("neighbor changed: %q, %v", data, readErr)
					}
				} else if _, readErr := os.Readlink(target); readErr != nil {
					t.Fatal(readErr)
				}
				if j.SourceDeleted || j.Output != output {
					t.Fatal("rejected move changed the job")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if data, readErr := os.ReadFile(target); readErr != nil || string(data) != "encoded" {
				t.Fatalf("result not moved: %q, %v", data, readErr)
			}
			if !j.SourceDeleted || j.Output != target {
				t.Fatal("successful move did not update the job")
			}
		})
	}
}
