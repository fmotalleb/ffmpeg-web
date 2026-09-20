package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type JobStatus string

const (
	StatusQueued   JobStatus = "queued"
	StatusRunning  JobStatus = "running"
	StatusDone     JobStatus = "done"
	StatusFailed   JobStatus = "failed"
	StatusCanceled JobStatus = "canceled"
)

// Job is one queued encode. Every exported field is both sent to the browser
// and written to the queue file, so a restart can pick up where it left off.
type Job struct {
	ID      string    `json:"id"`
	BatchID string    `json:"batchId,omitempty"`
	Label   string    `json:"label"` // path shown in the queue, relative for batches
	Spec    Spec      `json:"spec"`
	Source  string    `json:"source"`
	Output  string    `json:"output"`
	Status  JobStatus `json:"status"`

	Progress      float64 `json:"progress"` // 0..1
	Pass          int     `json:"pass"`
	Passes        int     `json:"passes"`
	FPS           float64 `json:"fps"`
	Speed         float64 `json:"speed"` // realtime multiplier
	Bitrate       string  `json:"bitrate"`
	Frame         int64   `json:"frame"`
	OutSize       int64   `json:"outSize"`
	EstimatedSize int64   `json:"estimatedSize"`
	SourceSize    int64   `json:"sourceSize"`
	SavedPct      float64 `json:"savedPct"` // how much smaller the result is
	ETA           float64 `json:"eta"`      // seconds left, -1 when unknown
	Duration      float64 `json:"duration"`

	Verified      bool   `json:"verified"`
	VerifyNote    string `json:"verifyNote,omitempty"`
	SourceDeleted bool   `json:"sourceDeleted"`
	Attempts      int    `json:"attempts"`
	Error         string `json:"error,omitempty"`

	Queued  time.Time `json:"queued"`
	Started time.Time `json:"started,omitempty"`
	Ended   time.Time `json:"ended,omitempty"`

	cancel context.CancelFunc
	logBuf []string
}

func (j *Job) clone() Job {
	c := *j
	c.cancel = nil
	c.logBuf = nil
	return c
}

func (j *Job) finished() bool {
	return j.Status == StatusDone || j.Status == StatusFailed || j.Status == StatusCanceled
}

// Manager owns the queue and runs one encode at a time.
type Manager struct {
	mu       sync.RWMutex
	jobs     map[string]*Job
	order    []string
	paused   bool
	settings QueueSettings

	ready   chan struct{}
	broker  *Broker
	store   *Store
	hooks   *hookRunner
	ffmpeg  string
	ffprobe string
	workDir string
	seq     int

	ranSinceIdle bool
}

func NewManager(ffmpeg, ffprobe, workDir string, broker *Broker, store *Store, hooks *hookRunner) *Manager {
	m := &Manager{
		jobs:     map[string]*Job{},
		settings: defaultSettings(),
		ready:    make(chan struct{}, 1),
		broker:   broker,
		store:    store,
		hooks:    hooks,
		ffmpeg:   ffmpeg,
		ffprobe:  ffprobe,
		workDir:  workDir,
	}
	return m
}

// Restore loads a saved queue. Anything that was mid-encode when the server
// died is reset to queued and its half-written output is deleted, so the file
// is encoded again from the start rather than left as a broken stub.
func (m *Manager) Restore(snap Snapshot) (recovered int) {
	m.mu.Lock()
	m.settings = snap.Settings
	m.paused = snap.Paused
	for i := range snap.Jobs {
		job := snap.Jobs[i]
		if job.Status == StatusRunning {
			if job.Output != "" {
				_ = os.Remove(job.Output)
			}
			job.Status = StatusQueued
			job.Progress = 0
			job.Pass = 0
			job.OutSize = 0
			job.EstimatedSize = 0
			job.ETA = -1
			job.Started = time.Time{}
			job.Error = ""
			recovered++
		}
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
	go m.loop()
	m.nudge()
}

func (m *Manager) Snapshot() Snapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	jobs := make([]Job, 0, len(m.order))
	for _, id := range m.order {
		if j, ok := m.jobs[id]; ok {
			jobs = append(jobs, j.clone())
		}
	}
	return Snapshot{
		Paused:   m.paused,
		Settings: m.settings,
		Jobs:     jobs,
		Order:    append([]string(nil), m.order...),
	}
}

func (m *Manager) save() { m.store.Touch() }

func (m *Manager) newID(prefix string) string {
	m.seq++
	return fmt.Sprintf("%s%d-%d", prefix, time.Now().UnixNano()/1e6, m.seq)
}

// Add queues one encode. duration and sourceSize may be zero; the worker
// probes the file itself before it starts.
func (m *Manager) Add(spec Spec, source, output, label, batchID string, duration, sourceSize float64) *Job {
	m.mu.Lock()
	passes := 1
	if spec.Video.TwoPass && spec.Video.RateMode == "bitrate" && spec.Video.Encoder != "copy" {
		passes = 2
	}
	job := &Job{
		ID: m.newID("j"), BatchID: batchID, Label: label, Spec: spec,
		Source: source, Output: output, Status: StatusQueued,
		Passes: passes, Duration: duration, SourceSize: int64(sourceSize),
		ETA: -1, Queued: time.Now(),
	}
	m.jobs[job.ID] = job
	m.order = append(m.order, job.ID)
	snapshot := job.clone()
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

func (m *Manager) List() []Job { return m.Snapshot().Jobs }

func (m *Manager) Get(id string) (Job, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	j, ok := m.jobs[id]
	if !ok {
		return Job{}, false
	}
	return j.clone(), true
}

func (m *Manager) Logs(id string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if j, ok := m.jobs[id]; ok {
		return append([]string(nil), j.logBuf...)
	}
	return nil
}

func (m *Manager) Settings() QueueSettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings
}

func (m *Manager) SetSettings(s QueueSettings) {
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

func (m *Manager) SetPaused(p bool) {
	m.mu.Lock()
	m.paused = p
	m.mu.Unlock()
	m.save()
	m.broker.Publish("queue", map[string]any{"paused": p})
	if !p {
		m.nudge()
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
	case StatusRunning:
		cancel := j.cancel
		m.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		return true
	case StatusQueued:
		j.Status = StatusCanceled
		j.Ended = time.Now()
		snapshot := j.clone()
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
	if j.Status == StatusRunning || j.Status == StatusQueued {
		m.mu.Unlock()
		return errors.New("that job has not finished yet")
	}
	if j.SourceDeleted {
		m.mu.Unlock()
		return errors.New("the source file was deleted, so this cannot be encoded again")
	}
	if j.Output != "" {
		_ = os.Remove(j.Output)
	}
	j.Status = StatusQueued
	j.Progress, j.Pass, j.OutSize, j.EstimatedSize, j.SavedPct = 0, 0, 0, 0, 0
	j.Error, j.VerifyNote, j.Verified = "", "", false
	j.ETA = -1
	j.Started, j.Ended = time.Time{}, time.Time{}
	snapshot := j.clone()
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
func (m *Manager) UpdateJob(id string, spec Spec, output string) error {
	m.mu.Lock()
	j, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return errors.New("no such job")
	}
	if j.Status == StatusRunning {
		m.mu.Unlock()
		return errors.New("cannot edit a job while it's encoding — cancel it first")
	}

	resetProgress := j.Status != StatusQueued
	if j.Output != "" && (resetProgress || j.Output != output) {
		_ = os.Remove(j.Output)
	}

	j.Spec = spec
	j.Output = output
	j.Passes = 1
	if spec.Video.TwoPass && spec.Video.RateMode == "bitrate" && spec.Video.Encoder != "copy" {
		j.Passes = 2
	}
	if resetProgress {
		j.Status = StatusQueued
		j.Progress, j.Pass, j.OutSize, j.EstimatedSize, j.SavedPct = 0, 0, 0, 0, 0
		j.Error, j.VerifyNote, j.Verified = "", "", false
		j.ETA = -1
		j.Started, j.Ended = time.Time{}, time.Time{}
	}
	snapshot := j.clone()
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
	var status JobStatus
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
	if status != StatusDone {
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
	snapshot := j.clone()
	m.mu.Unlock()
	m.save()
	m.broker.Publish("job", snapshot)
	return nil
}

func (m *Manager) next() *Job {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.paused {
		return nil
	}
	for _, id := range m.order {
		if j, ok := m.jobs[id]; ok && j.Status == StatusQueued {
			return j
		}
	}
	return nil
}

func (m *Manager) loop() {
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for {
		job := m.next()
		if job == nil {
			m.maybeFireHook()
			select {
			case <-m.ready:
			case <-tick.C:
			}
			continue
		}
		m.ranSinceIdle = true
		m.run(job)
	}
}

// maybeFireHook runs the post-queue action once per drain, not once per poll.
func (m *Manager) maybeFireHook() {
	if !m.ranSinceIdle {
		return
	}
	m.mu.RLock()
	pending := false
	for _, j := range m.jobs {
		if j.Status == StatusQueued || j.Status == StatusRunning {
			pending = true
			break
		}
	}
	summary := map[string]any{"done": 0, "failed": 0, "canceled": 0}
	for _, j := range m.jobs {
		switch j.Status {
		case StatusDone:
			summary["done"] = summary["done"].(int) + 1
		case StatusFailed:
			summary["failed"] = summary["failed"].(int) + 1
		case StatusCanceled:
			summary["canceled"] = summary["canceled"].(int) + 1
		}
	}
	hook := m.settings.PostQueue
	paused := m.paused
	m.mu.RUnlock()

	if pending || paused {
		return
	}
	m.ranSinceIdle = false
	summary["finishedAt"] = time.Now().Format(time.RFC3339)
	m.broker.Publish("queue", map[string]any{"drained": summary})
	go m.hooks.Run(hook, summary)
}

func (m *Manager) run(job *Job) {
	ctx, cancel := context.WithCancel(context.Background())

	m.mu.Lock()
	job.Status = StatusRunning
	job.Started = time.Now()
	job.Attempts++
	job.cancel = cancel
	job.Error = ""
	source := job.Source
	m.mu.Unlock()
	m.publish(job)
	m.save()

	// Batch jobs are queued without probing, so read the source now.
	if job.Duration == 0 || job.SourceSize == 0 {
		if info, err := probe(ctx, m.ffprobe, source); err == nil {
			m.mu.Lock()
			job.Duration = info.Duration
			job.SourceSize = info.Size
			m.mu.Unlock()
		} else if ctx.Err() == nil {
			cancel()
			m.finish(job, ctx, fmt.Errorf("cannot read the source file: %w", err))
			return
		}
	}

	if err := os.MkdirAll(filepath.Dir(job.Output), 0o755); err != nil {
		cancel()
		m.finish(job, ctx, fmt.Errorf("cannot create the output folder: %w", err))
		return
	}

	passLog := filepath.Join(m.workDir, job.ID)
	var runErr error

	if job.Passes == 2 {
		for _, pass := range []int{1, 2} {
			m.mu.Lock()
			job.Pass = pass
			job.Progress = 0
			m.mu.Unlock()
			m.publish(job)
			if runErr = m.exec(ctx, job, passLog, pass); runErr != nil {
				break
			}
		}
		for _, suffix := range []string{"-0.log", "-0.log.mbtree"} {
			os.Remove(passLog + suffix)
		}
	} else {
		m.mu.Lock()
		job.Pass = 1
		m.mu.Unlock()
		runErr = m.exec(ctx, job, passLog, 0)
	}

	m.finish(job, ctx, runErr)
	cancel()
}

// finish records the outcome, verifies the file and applies the post-job rule.
func (m *Manager) finish(job *Job, ctx context.Context, runErr error) {
	stopped := ctx.Err() != nil || errors.Is(runErr, context.Canceled)
	settings := m.Settings()

	m.mu.Lock()
	job.cancel = nil
	job.Ended = time.Now()
	job.ETA = 0
	switch {
	case stopped:
		job.Status = StatusCanceled
		os.Remove(job.Output)
	case runErr != nil:
		job.Status = StatusFailed
		job.Error = runErr.Error()
	default:
		job.Status = StatusDone
		job.Progress = 1
		if st, err := os.Stat(job.Output); err == nil {
			job.OutSize = st.Size()
			job.EstimatedSize = st.Size()
			if job.SourceSize > 0 {
				job.SavedPct = (1 - float64(st.Size())/float64(job.SourceSize)) * 100
			}
		}
	}
	output, expected := job.Output, encodedLength(job)
	done := job.Status == StatusDone
	m.mu.Unlock()

	if done && settings.VerifyOutput {
		note, err := verifyOutput(context.Background(), m.ffmpeg, m.ffprobe, output, expected)
		m.mu.Lock()
		job.VerifyNote = note
		if err != nil {
			job.Verified = false
			job.Status = StatusFailed
			job.Error = err.Error()
			done = false
		} else {
			job.Verified = true
		}
		m.mu.Unlock()
	} else if done {
		m.mu.Lock()
		job.Verified = false
		job.VerifyNote = "file check is switched off"
		m.mu.Unlock()
	}

	if done && settings.AutoDeleteSource {
		m.mu.RLock()
		saved := job.SavedPct
		id := job.ID
		m.mu.RUnlock()
		if saved >= settings.ShrinkThreshold {
			if err := m.DeleteSource(id, func(string) error { return nil }); err != nil {
				m.appendLog(job, "could not delete the source: "+err.Error())
			}
		}
	}

	m.publish(job)
	m.save()
	m.nudge()
}

func encodedLength(job *Job) float64 {
	if job.Spec.Trim.Enabled && job.Spec.Trim.End > job.Spec.Trim.Start {
		return job.Spec.Trim.End - job.Spec.Trim.Start
	}
	return job.Duration
}

func (m *Manager) publish(j *Job) {
	m.mu.RLock()
	snapshot := j.clone()
	m.mu.RUnlock()
	m.broker.Publish("job", snapshot)
}

func (m *Manager) exec(ctx context.Context, job *Job, passLog string, pass int) error {
	m.mu.RLock()
	spec, source, output := job.Spec, job.Source, job.Output
	m.mu.RUnlock()

	args, err := buildArgs(spec, source, output, passLog, pass)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, m.ffmpeg, args...)
	cmd.Dir = m.workDir
	m.appendLog(job, "ffmpeg "+strings.Join(args, " "))

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start ffmpeg: %w", err)
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); m.readProgress(job, stdout) }()

	var errLines []string
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			errLines = append(errLines, line)
			if len(errLines) > 40 {
				errLines = errLines[1:]
			}
			m.appendLog(job, line)
		}
	}()
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if len(errLines) > 0 {
			return fmt.Errorf("%s", errLines[len(errLines)-1])
		}
		return fmt.Errorf("ffmpeg exited: %w", err)
	}
	return nil
}

func (m *Manager) appendLog(job *Job, line string) {
	m.mu.Lock()
	job.logBuf = append(job.logBuf, line)
	if len(job.logBuf) > 400 {
		job.logBuf = job.logBuf[len(job.logBuf)-400:]
	}
	m.mu.Unlock()
}

func (m *Manager) readProgress(job *Job, r io.Reader) {
	sc := bufio.NewScanner(r)
	last := time.Now()
	for sc.Scan() {
		key, value, ok := strings.Cut(strings.TrimSpace(sc.Text()), "=")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)

		m.mu.Lock()
		switch key {
		case "frame":
			job.Frame, _ = strconv.ParseInt(value, 10, 64)
		case "fps":
			job.FPS, _ = strconv.ParseFloat(value, 64)
		case "bitrate":
			if value != "N/A" {
				job.Bitrate = value
			}
		case "total_size":
			job.OutSize, _ = strconv.ParseInt(value, 10, 64)
		case "speed":
			job.Speed, _ = strconv.ParseFloat(strings.TrimSuffix(value, "x"), 64)
		case "out_time":
			total := encodedLength(job)
			if secs, err := parseTimecode(value); err == nil && total > 0 {
				job.Progress = clamp(secs/total, 0, 1)
				if job.Speed > 0 {
					job.ETA = (total - secs) / job.Speed
				}
				// Project the finished size from what has been written so far.
				if job.Progress > 0.03 && job.OutSize > 0 && job.Pass != 1 {
					job.EstimatedSize = int64(float64(job.OutSize) / job.Progress)
					if job.SourceSize > 0 {
						job.SavedPct = (1 - float64(job.EstimatedSize)/float64(job.SourceSize)) * 100
					}
				}
			}
		case "progress":
			if value == "end" {
				job.Progress = 1
			}
		}
		snapshot := job.clone()
		m.mu.Unlock()

		if key == "progress" && (value == "end" || time.Since(last) > 400*time.Millisecond) {
			last = time.Now()
			m.broker.Publish("job", snapshot)
		}
	}
}

func parseTimecode(v string) (float64, error) {
	if v == "N/A" {
		return 0, errors.New("not available")
	}
	parts := strings.Split(v, ":")
	if len(parts) != 3 {
		return strconv.ParseFloat(v, 64)
	}
	h, err1 := strconv.ParseFloat(parts[0], 64)
	mnt, err2 := strconv.ParseFloat(parts[1], 64)
	s, err3 := strconv.ParseFloat(parts[2], 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return 0, fmt.Errorf("bad timecode %q", v)
	}
	return h*3600 + mnt*60 + s, nil
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ---- server-sent events ----

type Broker struct {
	mu   sync.RWMutex
	subs map[chan []byte]struct{}
}

func NewBroker() *Broker { return &Broker{subs: map[chan []byte]struct{}{}} }

func (b *Broker) Subscribe() chan []byte {
	ch := make(chan []byte, 64)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Broker) Unsubscribe(ch chan []byte) {
	b.mu.Lock()
	if _, ok := b.subs[ch]; ok {
		delete(b.subs, ch)
		close(ch)
	}
	b.mu.Unlock()
}

func (b *Broker) Publish(event string, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := []byte("event: " + event + "\ndata: " + string(body) + "\n\n")
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs {
		select {
		case ch <- msg:
		default: // slow client: drop the frame rather than stall the encoder
		}
	}
}
