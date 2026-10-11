// Package keepawake keeps the host from going to sleep while an encode runs.
// It is off unless the server is started with -keep-awake (or KEEP_AWAKE=1),
// and it degrades to a single logged warning on a platform it cannot talk to.
package keepawake

import (
	"sync"

	"go.uber.org/zap"
)

// Holder holds a platform keep-awake request while an encode is running. The
// zero value is not usable; call New. Its methods are safe on a nil *Holder,
// which lets callers that do not care about keep-awake pass nil around.
type Holder struct {
	enabled bool
	log     *zap.Logger

	mu      sync.Mutex
	held    bool
	release func()
}

// New returns a Holder. When enabled is false every method is a no-op, which is
// the default: the machine is free to sleep.
func New(enabled bool, log *zap.Logger) *Holder {
	if log == nil {
		log = zap.NewNop()
	}
	return &Holder{enabled: enabled, log: log}
}

// Enabled reports whether keep-awake was turned on at startup.
func (h *Holder) Enabled() bool {
	return h != nil && h.enabled
}

// Acquire keeps the machine awake until Release. It is idempotent: calling it
// while already held does nothing.
func (h *Holder) Acquire() {
	if h == nil || !h.enabled {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.held {
		return
	}
	release, err := platformHold()
	if err != nil {
		// A platform that cannot hold the machine awake now will not start
		// working later, so turn the feature off for good and warn once —
		// rather than on every job.
		h.enabled = false
		h.log.Warn("could not keep the machine awake; encodes may be interrupted by sleep",
			zap.Error(err))
		return
	}
	h.release = release
	h.held = true
}

// Release lets the machine sleep again. It is idempotent.
func (h *Holder) Release() {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.held {
		return
	}
	h.release()
	h.release = nil
	h.held = false
}
