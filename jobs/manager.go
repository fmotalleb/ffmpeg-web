package jobs

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
	"github.com/fmotalleb/ffmpeg-web/proc"
	"github.com/fmotalleb/ffmpeg-web/storage"
)

// Manager owns the queue and runs one encode at a time.
type Manager struct {
	mu       sync.RWMutex
	jobs     map[string]*storage.Job
	order    []string
	paused   bool
	settings storage.QueueSettings

	log     *zap.Logger
	ready   chan struct{}
	broker  *Broker
	store   *storage.Store
	hooks   *HookRunner
	ffmpeg  string
	ffprobe string
	workDir string
	seq     int

	ranSinceIdle bool
}

func NewManager(ffmpegBin, ffprobeBin, workDir string, broker *Broker, store *storage.Store, hooks *HookRunner, log *zap.Logger) *Manager {
	m := &Manager{
		jobs:     map[string]*storage.Job{},
		settings: storage.DefaultSettings(),
		log:      log,
		ready:    make(chan struct{}, 1),
		broker:   broker,
		store:    store,
		hooks:    hooks,
		ffmpeg:   ffmpegBin,
		ffprobe:  ffprobeBin,
		workDir:  workDir,
	}
	return m
}

// Restore loads a saved queue. Anything that was mid-encode when the server
// died is reset to queued and its half-written output is deleted, so the file
// is encoded again from the start rather than left as a broken stub.
func (m *Manager) Restore(snap storage.Snapshot) (recovered int) {
	m.mu.Lock()
	m.settings = snap.Settings
	m.paused = snap.Paused
	for i := range snap.Jobs {
		job := snap.Jobs[i]
		if job.Status == storage.StatusRunning {
			// A move-in-place run encoded into the work folder and left the
			// original alone, so only that half-written file is thrown away.
			if job.Spec.MoveInPlace {
				_ = os.Remove(m.encodeTarget(&job))
			} else if job.Output != "" {
				_ = os.Remove(job.Output)
			}
			job.Status = storage.StatusQueued
			job.Progress = 0
			job.Pass = 0
			job.OutSize = 0
			job.ETA = -1
			job.Started = time.Time{}
			job.Error = ""
			recovered++
		}
		job.FfmpegPID = 0
		copyJob := job
		m.jobs[job.ID] = &copyJob
	}
	m.order = nil
	for _, id := range snap.Order {
		if _, ok := m.jobs[id]; ok {
			m.order = append(m.order, id)
		}
	}
	for id := range m.jobs { // anything missing from the order list
		if !contains(m.order, id) {
			m.order = append(m.order, id)
		}
	}
	m.mu.Unlock()
	return recovered
}

func contains(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}

func (m *Manager) Start() {
	go m.cleanLogs()
	go m.loop()
	m.nudge()
}

// cleanLogs drops per-run ffmpeg logs older than a day. Each run writes
// workDir/ffmpeg-<pid>.log so the browser can tail it by pid; the file is kept
// after the job ends so a failed encode's output stays readable, but not
// forever — long enough to check on yesterday's failure, not to fill the disk.
func (m *Manager) cleanLogs() {
	entries, err := os.ReadDir(m.workDir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, "ffmpeg-") || !strings.HasSuffix(name, ".log") {
			continue
		}
		if info, err := e.Info(); err == nil && info.ModTime().Before(cutoff) {
			os.Remove(filepath.Join(m.workDir, name))
		}
	}
}

func (m *Manager) Snapshot() storage.Snapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	jobs := make([]storage.Job, 0, len(m.order))
	for _, id := range m.order {
		if j, ok := m.jobs[id]; ok {
			jobs = append(jobs, j.Clone())
		}
	}
	return storage.Snapshot{
		Paused:   m.paused,
		Settings: m.settings,
		Jobs:     jobs,
		Order:    append([]string(nil), m.order...),
	}
}

func (m *Manager) save() { m.store.Touch() }

// NewID mints an id for a job or a batch. The prefix keeps the two apart in the
// queue file, and the sequence makes an id unique within one millisecond.
func (m *Manager) NewID(prefix string) string {
	m.seq++
	return fmt.Sprintf("%s%d-%d", prefix, time.Now().UnixNano()/1e6, m.seq)
}

// Add queues one encode. duration and sourceSize may be zero; the worker
// probes the file itself before it starts.
func (m *Manager) Add(spec ffmpeg.Spec, source, output, label, batchID string, duration, sourceSize float64) *storage.Job {
	m.mu.Lock()
	passes := 1
	if ffmpeg.TwoPassWanted(spec) {
		passes = 2
	}
	job := &storage.Job{
		ID: m.NewID("j"), BatchID: batchID, Label: label, Spec: spec,
		Source: source, Output: output, Status: storage.StatusQueued,
		Passes: passes, Duration: duration, SourceSize: int64(sourceSize),
		ETA: -1, Queued: time.Now(),
	}
	m.jobs[job.ID] = job
	m.order = append(m.order, job.ID)
	snapshot := job.Clone()
	m.mu.Unlock()

	m.save()
	m.broker.Publish("job", snapshot)
	m.nudge()
	return job
}

func (m *Manager) nudge() {
	select {
	case m.ready <- struct{}{}:
	default:
	}
}

func (m *Manager) List() []storage.Job { return m.Snapshot().Jobs }

// FfmpegPIDs is the encode process of every running job, keyed by job id. The
// system report reads these PIDs out of the process table directly, which is
// how a job row can show its own ffmpeg rather than whichever ffmpeg happens to
// be running on the machine.
func (m *Manager) FfmpegPIDs() map[string]int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := map[string]int{}
	for id, j := range m.jobs {
		if j.Status == storage.StatusRunning && j.FfmpegPID != 0 {
			out[id] = j.FfmpegPID
		}
	}
	return out
}

func (m *Manager) Get(id string) (storage.Job, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	j, ok := m.jobs[id]
	if !ok {
		return storage.Job{}, false
	}
	return j.Clone(), true
}

func (m *Manager) Logs(id string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if j, ok := m.jobs[id]; ok {
		return j.Logs()
	}
	return nil
}

func (m *Manager) Settings() storage.QueueSettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings
}

func (m *Manager) SetSettings(s storage.QueueSettings) {
	if s.ShrinkThreshold < 0 {
		s.ShrinkThreshold = 0
	}
	if s.ShrinkThreshold > 95 {
		s.ShrinkThreshold = 95
	}
	if s.PostQueue.Type == "" {
		s.PostQueue.Type = "none"
	}
	m.mu.Lock()
	m.settings = s
	m.mu.Unlock()
	m.save()
	m.broker.Publish("queue", map[string]any{"settings": s})
}

func (m *Manager) Paused() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.paused
}

// SetPaused holds the queue still or lets it run on. Pausing also freezes the
// encode already in flight — the point of pausing is to stop burning CPU now,
// not just to wait before the next job — so the signal goes out under the lock
// that guards the running job's pid: a process starting at the same moment
// either gets stopped here, or sees the new paused state in exec and stops
// itself, and no resume can slip between those two.
func (m *Manager) SetPaused(p bool) {
	m.mu.Lock()
	m.paused = p
	for _, j := range m.jobs {
		if j.Status == storage.StatusRunning && j.FfmpegPID != 0 {
			m.setFrozen(j.FfmpegPID, p)
		}
	}
	m.mu.Unlock()
	m.save()
	m.broker.Publish("queue", map[string]any{"paused": p})
	if !p {
		m.nudge()
	}
}

// setFrozen stops or wakes one encode process. Best effort: a process that
// has just exited cannot be signaled, and there is nothing to do about that.
func (m *Manager) setFrozen(pid int, frozen bool) {
	if err := proc.SetFrozen(pid, frozen); err != nil {
		m.log.Debug("could not signal ffmpeg", zap.Int("pid", pid),
			zap.Bool("frozen", frozen), zap.Error(err))
	}
}

// ThawFrozen wakes every stopped encode. Shutdown calls it: a process left
// frozen would stay frozen forever, because nothing left can signal it.
func (m *Manager) ThawFrozen() {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, j := range m.jobs {
		if j.Status == storage.StatusRunning && j.FfmpegPID != 0 {
			m.setFrozen(j.FfmpegPID, false)
		}
	}
}

// Move shifts a waiting job through the queue. delta of 0 sends it to the top.
func (m *Manager) Move(id string, delta int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	idx := -1
	for i, v := range m.order {
		if v == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return false
	}
	target := idx + delta
	if delta == 0 {
		target = 0
	}
	m.order = append(m.order[:idx], m.order[idx+1:]...)
	if target < 0 {
		target = 0
	}
	if target > len(m.order) {
		target = len(m.order)
	}
	reordered := make([]string, 0, len(m.order)+1)
	reordered = append(reordered, m.order[:target]...)
	reordered = append(reordered, id)
	reordered = append(reordered, m.order[target:]...)
	m.order = reordered
	m.store.Touch()
	m.broker.Publish("queue", map[string]any{"order": m.order})
	return true
}

func (m *Manager) Cancel(id string) bool {
	m.mu.Lock()
	j, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return false
	}
	switch j.Status {
	case storage.StatusRunning:
		cancel := j.CancelFunc()
		m.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		return true
	case storage.StatusQueued:
		j.Status = storage.StatusCanceled
		j.Ended = time.Now()
		snapshot := j.Clone()
		m.mu.Unlock()
		m.save()
		m.broker.Publish("job", snapshot)
		return true
	}
	m.mu.Unlock()
	return false
}

// Retry puts a finished or failed job back in the queue and throws away
// whatever it produced last time.
func (m *Manager) Retry(id string) error {
	m.mu.Lock()
	j, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return errors.New("no such job")
	}
	if j.Status == storage.StatusRunning || j.Status == storage.StatusQueued {
		m.mu.Unlock()
		return errors.New("that job has not finished yet")
	}
	if j.SourceDeleted {
		m.mu.Unlock()
		return errors.New("the source file was deleted, so this cannot be encoded again")
	}
	if j.Output != "" && !j.Spec.MoveInPlace {
		_ = os.Remove(j.Output)
	}
	j.Status = storage.StatusQueued
	j.Progress, j.Pass, j.OutSize, j.SavedPct = 0, 0, 0, 0
	j.Error, j.VerifyNote, j.Verified = "", "", false
	j.ETA = -1
	j.Started, j.Ended = time.Time{}, time.Time{}
	snapshot := j.Clone()
	m.mu.Unlock()

	m.save()
	m.broker.Publish("job", snapshot)
	m.nudge()
	return nil
}

// UpdateJob replaces a job's settings and output path. Editing a job that has
// already run (done, failed, canceled) throws away its old output and puts it
// back in the queue, the same as a retry with new settings. Editing a queued
// job just changes what it will do when its turn comes. A running job cannot
// be edited — cancel it first.
func (m *Manager) UpdateJob(id string, spec ffmpeg.Spec, output string) error {
	m.mu.Lock()
	j, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return errors.New("no such job")
	}
	if j.Status == storage.StatusRunning {
		m.mu.Unlock()
		return errors.New("cannot edit a job while it's encoding — cancel it first")
	}

	resetProgress := j.Status != storage.StatusQueued
	// A move-in-place job's output path is its source as well, so it must not
	// be deleted here — that would throw away the only copy.
	wasInPlace := j.Spec.MoveInPlace
	if j.Output != "" && !wasInPlace && (resetProgress || j.Output != output) {
		_ = os.Remove(j.Output)
	}

	j.Spec = spec
	j.Output = output
	j.Passes = 1
	if ffmpeg.TwoPassWanted(spec) {
		j.Passes = 2
	}
	if resetProgress {
		j.Status = storage.StatusQueued
		j.Progress, j.Pass, j.OutSize, j.SavedPct = 0, 0, 0, 0
		j.Error, j.VerifyNote, j.Verified = "", "", false
		j.ETA = -1
		j.Started, j.Ended = time.Time{}, time.Time{}
	}
	snapshot := j.Clone()
	m.mu.Unlock()

	m.save()
	m.broker.Publish("job", snapshot)
	m.nudge()
	return nil
}

func (m *Manager) Remove(id string) bool {
	m.Cancel(id)
	m.mu.Lock()
	if _, ok := m.jobs[id]; !ok {
		m.mu.Unlock()
		return false
	}
	delete(m.jobs, id)
	for i, v := range m.order {
		if v == id {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	m.mu.Unlock()
	m.save()
	m.broker.Publish("queue", map[string]any{"removed": id})
	return true
}

// DeleteSource removes the original file for a finished job. Callers pass a
// guard so the file can only go if it sits inside an allowed folder.
func (m *Manager) DeleteSource(id string, allowed func(string) error) error {
	m.mu.RLock()
	j, ok := m.jobs[id]
	var source string
	var verified bool
	var status storage.JobStatus
	var deleted bool
	if ok {
		source, verified, status, deleted = j.Source, j.Verified, j.Status, j.SourceDeleted
	}
	m.mu.RUnlock()

	if !ok {
		return errors.New("no such job")
	}
	if deleted {
		return nil
	}
	if status != storage.StatusDone {
		return errors.New("this encode has not finished")
	}
	if m.Settings().VerifyOutput && !verified {
		return errors.New("the result has not passed the file check, so the source stays")
	}
	if err := allowed(source); err != nil {
		return err
	}
	if err := os.Remove(source); err != nil && !os.IsNotExist(err) {
		return err
	}

	m.mu.Lock()
	j.SourceDeleted = true
	snapshot := j.Clone()
	m.mu.Unlock()
	m.save()
	m.broker.Publish("job", snapshot)
	return nil
}

// MoveInPlace replaces a finished job's source file with what it encoded. The
// result takes the source's folder and stem, keeping the output's container, so
// a changed container leaves the old file beside it until it is removed. Only a
// done job whose source is still there can be moved, and the source is gone
// afterwards — which the job records, so a retry does not pretend otherwise.
func (m *Manager) MoveInPlace(id string) error {
	m.mu.RLock()
	j, ok := m.jobs[id]
	if !ok {
		m.mu.RUnlock()
		return errors.New("no such job")
	}
	if j.Status != storage.StatusDone {
		m.mu.RUnlock()
		return errors.New("only a finished job can be moved into place")
	}
	if j.SourceDeleted {
		m.mu.RUnlock()
		return errors.New("the source file is already gone")
	}
	source, output := j.Source, j.Output
	m.mu.RUnlock()

	if output == "" || output == source {
		return errors.New("there is nothing to move into place")
	}
	if _, err := os.Stat(output); err != nil {
		return errors.New("the encoded file has been moved or deleted")
	}
	if _, err := os.Stat(source); err != nil {
		return errors.New("the source file has been moved or deleted")
	}

	target := filepath.Join(
		filepath.Dir(source),
		strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))+filepath.Ext(output),
	)
	if err := moveIntoPlace(output, target); err != nil {
		return fmt.Errorf("could not replace the source file: %w", err)
	}
	// A changed container gives the result a new name, so the old file is still
	// sitting beside it and has to go.
	if target != source {
		if err := os.Remove(source); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("could not remove the old source file: %w", err)
		}
	}

	m.mu.Lock()
	j.Output = target
	j.SourceDeleted = true
	snapshot := j.Clone()
	m.mu.Unlock()
	m.save()
	m.broker.Publish("job", snapshot)
	return nil
}
