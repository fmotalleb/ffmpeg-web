package jobs

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fmotalleb/go-tools/log"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
	"github.com/fmotalleb/ffmpeg-web/probe"
	"github.com/fmotalleb/ffmpeg-web/proc"
	"github.com/fmotalleb/ffmpeg-web/storage"
)

func (m *Manager) next() *storage.Job {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.paused {
		return nil
	}
	for _, id := range m.order {
		if j, ok := m.jobs[id]; ok && j.Status == storage.StatusQueued {
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
		if j.Status == storage.StatusQueued || j.Status == storage.StatusRunning {
			pending = true
			break
		}
	}
	summary := map[string]any{"done": 0, "failed": 0, "canceled": 0}
	for _, j := range m.jobs {
		switch j.Status {
		case storage.StatusDone:
			summary["done"] = summary["done"].(int) + 1
		case storage.StatusFailed:
			summary["failed"] = summary["failed"].(int) + 1
		case storage.StatusCanceled:
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

// encodeTarget is the path a run actually writes. An ordinary job writes
// straight to its output; a move-in-place job writes into the work folder, so
// the original file survives until the new one is finished and checked.
func (m *Manager) encodeTarget(job *storage.Job) string {
	if !job.Spec.MoveInPlace {
		return job.Output
	}
	ext := filepath.Ext(job.Output)
	if ext == "" {
		ext = "." + ffmpeg.NormalizeContainer(job.Spec.Container)
	}
	return filepath.Join(m.workDir, job.ID+"-inplace"+ext)
}

// moveIntoPlace puts a finished encode where the original file was. A rename is
// atomic when both live on one filesystem; otherwise the bytes are copied to a
// temporary file in the destination folder first, and only then swapped in, so
// the original is never left half-written.
func moveIntoPlace(from, to string) error {
	if from == "" || from == to {
		return nil
	}
	if err := os.Rename(from, to); err == nil {
		return nil
	}

	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()

	tmp, err := os.CreateTemp(filepath.Dir(to), ".ffmpeg-web-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := io.Copy(tmp, in); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, to); err != nil {
		// Windows will not rename onto an existing file. The replacement is
		// safely on disk by now, so the old one can go.
		if removeErr := os.Remove(to); removeErr != nil && !os.IsNotExist(removeErr) {
			os.Remove(tmpName)
			return err
		}
		if err := os.Rename(tmpName, to); err != nil {
			os.Remove(tmpName)
			return err
		}
	}
	return os.Remove(from)
}

// commitInPlace swaps a finished, checked encode over the file it came from.
// The original is gone afterwards, which the job records so a retry does not
// pretend the old file is still there.
func (m *Manager) commitInPlace(job *storage.Job) error {
	m.mu.RLock()
	tmp, out, source := m.encodeTarget(job), job.Output, job.Source
	m.mu.RUnlock()

	if err := moveIntoPlace(tmp, out); err != nil {
		return fmt.Errorf("could not replace the source file: %w", err)
	}
	// A changed container gives the result a new name, so the old file is still
	// sitting beside it and has to go.
	if out != source {
		if err := os.Remove(source); err != nil && !os.IsNotExist(err) {
			m.appendLog(job, "could not remove the old source file: "+err.Error())
		}
	}
	m.mu.Lock()
	job.SourceDeleted = true
	m.mu.Unlock()
	return nil
}

func (m *Manager) run(job *storage.Job) {
	ctx, cancel := context.WithCancel(context.Background())

	m.mu.Lock()
	job.Status = storage.StatusRunning
	job.Started = time.Now()
	job.Attempts++
	job.SetCancel(cancel)
	job.Error = ""
	source := job.Source
	m.mu.Unlock()
	m.publish(job)
	m.save()

	// Batch jobs are queued without probing, so read the source now.
	if job.Duration == 0 || job.SourceSize == 0 {
		if info, err := probe.Probe(log.WithLogger(ctx, m.log), m.ffprobe, source); err == nil {
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
	target := m.encodeTarget(job)
	var runErr error

	if job.Passes == 2 {
		for _, pass := range []int{1, 2} {
			m.mu.Lock()
			job.Pass = pass
			job.Progress = 0
			m.mu.Unlock()
			m.publish(job)
			if runErr = m.exec(ctx, job, target, passLog, pass); runErr != nil {
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
		runErr = m.exec(ctx, job, target, passLog, 0)
	}

	m.finish(job, ctx, runErr)
	cancel()
}

// finish records the outcome, verifies the file and applies the post-job rule.
func (m *Manager) finish(job *storage.Job, ctx context.Context, runErr error) {
	stopped := ctx.Err() != nil || errors.Is(runErr, context.Canceled)
	settings := m.Settings()

	m.mu.Lock()
	job.SetCancel(nil)
	job.Ended = time.Now()
	job.ETA = 0
	switch {
	case stopped:
		job.Status = storage.StatusCanceled
		os.Remove(m.encodeTarget(job))
	case runErr != nil:
		job.Status = storage.StatusFailed
		job.Error = runErr.Error()
		if job.Spec.MoveInPlace {
			os.Remove(m.encodeTarget(job))
		}
	default:
		job.Status = storage.StatusDone
		job.Progress = 1
		// Stat what the run actually wrote: on a move-in-place job the output
		// path still holds the original file at this point.
		if st, err := os.Stat(m.encodeTarget(job)); err == nil {
			job.OutSize = st.Size()
			if job.SourceSize > 0 {
				job.SavedPct = (1 - float64(st.Size())/float64(job.SourceSize)) * 100
			}
		}
	}
	// The check runs against what was encoded, and only once it passes does a
	// move-in-place job take the source's place.
	output, expected := m.encodeTarget(job), encodedLength(job)
	done := job.Status == storage.StatusDone
	m.mu.Unlock()

	if done && settings.VerifyOutput {
		note, err := ffmpeg.VerifyOutput(log.WithLogger(context.Background(), m.log), m.ffmpeg, m.ffprobe, output, expected)
		m.mu.Lock()
		job.VerifyNote = note
		if err != nil {
			job.Verified = false
			job.Status = storage.StatusFailed
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

	if done && job.Spec.MoveInPlace {
		if err := m.commitInPlace(job); err != nil {
			m.mu.Lock()
			job.Status = storage.StatusFailed
			job.Error = err.Error()
			done = false
			m.mu.Unlock()
		}
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

func encodedLength(job *storage.Job) float64 {
	if job.Spec.Trim.Enabled && job.Spec.Trim.End > job.Spec.Trim.Start {
		return job.Spec.Trim.End - job.Spec.Trim.Start
	}
	return job.Duration
}

func (m *Manager) publish(j *storage.Job) {
	m.mu.RLock()
	snapshot := j.Clone()
	m.mu.RUnlock()
	m.broker.Publish("job", snapshot)
}

func (m *Manager) exec(ctx context.Context, job *storage.Job, target, passLog string, pass int) error {
	m.mu.RLock()
	spec, source := job.Spec, job.Source
	m.mu.RUnlock()

	args, err := ffmpeg.BuildArgs(spec, source, target, passLog, pass)
	if err != nil {
		return err
	}
	cmd := proc.Exec(ctx, m.ffmpeg, args...)
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
	m.mu.Lock()
	job.FfmpegPID = cmd.Process.Pid
	// A pause that landed while ffmpeg was starting still has to catch this
	// process, or pausing would let a just-started encode run until the next
	// toggle. Same lock as SetPaused signals under, so one of the two wins and
	// the process ends up stopped either way.
	if m.paused {
		m.setFrozen(cmd.Process.Pid, true)
	}
	m.mu.Unlock()

	// This run's stderr also goes to workDir/ffmpeg-<pid>.log, keyed by the
	// pid the browser is shown, so its Log button can tail the exact process —
	// including after the job has finished, failed or been cancelled.
	logW := newRunLog(m.workDir, cmd.Process.Pid, args)

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
			logW.write(line)
			errLines = append(errLines, line)
			if len(errLines) > 40 {
				errLines = errLines[1:]
			}
			m.appendLog(job, line)
		}
	}()
	wg.Wait()
	logW.close()

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

func (m *Manager) appendLog(job *storage.Job, line string) {
	m.mu.Lock()
	job.AppendLog(line)
	m.mu.Unlock()
}

// runLog is one ffmpeg run's log file: workDir/ffmpeg-<pid>.log. The queue
// already keeps the last 400 lines in memory for the job, but the browser
// talks about processes — the pid in a job row or the hardware popover — so
// the file is keyed by pid instead and outlives the job. Best effort: a run
// whose log cannot be written proceeds without one.
type runLog struct {
	f *os.File
	w *bufio.Writer
}

func newRunLog(workDir string, pid int, args []string) runLog {
	f, err := os.Create(filepath.Join(workDir, fmt.Sprintf("ffmpeg-%d.log", pid)))
	if err != nil {
		return runLog{}
	}
	w := bufio.NewWriter(f)
	fmt.Fprintf(w, "$ ffmpeg %s\n", strings.Join(args, " "))
	return runLog{f: f, w: w}
}

func (l runLog) write(line string) {
	if l.w == nil {
		return
	}
	fmt.Fprintln(l.w, line)
}

func (l runLog) close() {
	if l.f == nil {
		return
	}
	_ = l.w.Flush()
	_ = l.f.Close()
}

func (m *Manager) readProgress(job *storage.Job, r io.Reader) {
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
			}
		case "progress":
			if value == "end" {
				job.Progress = 1
			}
		}
		snapshot := job.Clone()
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
