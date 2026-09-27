package storage

import (
	"context"
	"time"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
)

// JobStatus is where a job is in its life: waiting, encoding, or finished one
// way or another.
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
	ID      string      `json:"id"`
	BatchID string      `json:"batchId,omitempty"`
	Label   string      `json:"label"` // path shown in the queue, relative for batches
	Spec    ffmpeg.Spec `json:"spec"`
	Source  string      `json:"source"`
	Output  string      `json:"output"`
	Status  JobStatus   `json:"status"`

	Progress   float64 `json:"progress"` // 0..1
	Pass       int     `json:"pass"`
	Passes     int     `json:"passes"`
	FPS        float64 `json:"fps"`
	Speed      float64 `json:"speed"` // realtime multiplier
	Bitrate    string  `json:"bitrate"`
	Frame      int64   `json:"frame"`
	OutSize    int64   `json:"outSize"`
	SourceSize int64   `json:"sourceSize"`
	SavedPct   float64 `json:"savedPct"` // how much smaller the result is
	ETA        float64 `json:"eta"`      // seconds left, -1 when unknown
	Duration   float64 `json:"duration"`

	Verified      bool   `json:"verified"`
	VerifyNote    string `json:"verifyNote,omitempty"`
	SourceDeleted bool   `json:"sourceDeleted"`
	Attempts      int    `json:"attempts"`
	Error         string `json:"error,omitempty"`

	Queued  time.Time `json:"queued"`
	Started time.Time `json:"started,omitempty"`
	Ended   time.Time `json:"ended,omitempty"`

	// FfmpegPID is the process this job is encoding with. It is set while the
	// job runs and kept afterwards, so the log of a finished run — the one worth
	// reading — stays reachable from the queue. A restored queue clears it,
	// because the pid only means anything within this run of the server.
	FfmpegPID int `json:"ffmpegPid,omitempty"`

	// Runtime-only state. It is deliberately unexported so it never reaches the
	// queue file, and the Manager reaches it through the methods below.
	cancel context.CancelFunc
	logBuf []string
}

// Clone returns a copy safe to hand to the broker or the store: the runtime
// cancel handle is dropped, and the log buffer is detached from the original.
func (j *Job) Clone() Job {
	c := *j
	c.cancel = nil
	c.logBuf = nil
	return c
}

// SetCancel records the handle that stops this job's encode.
func (j *Job) SetCancel(cancel context.CancelFunc) {
	j.cancel = cancel
}

// CancelFunc returns the handle that stops this job's encode, if it is running.
func (j *Job) CancelFunc() context.CancelFunc {
	return j.cancel
}

// AppendLog adds one line to the in-memory tail of this job's log, keeping the
// last 400 lines. The same lines also go to the per-pid log file.
func (j *Job) AppendLog(line string) {
	j.logBuf = append(j.logBuf, line)
	if len(j.logBuf) > 400 {
		j.logBuf = j.logBuf[len(j.logBuf)-400:]
	}
}

// Logs returns a copy of the last lines this job wrote.
func (j *Job) Logs() []string {
	return append([]string(nil), j.logBuf...)
}
