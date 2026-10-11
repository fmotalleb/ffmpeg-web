//go:build windows

package keepawake

import (
	"errors"
	"runtime"
	"sync"
	"syscall"
)

var (
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	procSetThreadExecState = kernel32.NewProc("SetThreadExecutionState")
)

// Windows execution-state flags (winuser.h).
const (
	esContinuous    = 0x80000000
	esSystemRequired = 0x00000001
)

// platformHold asks Windows to keep the system awake via SetThreadExecutionState.
//
// That call is per-thread, and Go moves goroutines between threads, so the
// request is made from a goroutine pinned to its OS thread for as long as the
// hold lasts. Releasing closes done, which lets that goroutine clear the state
// and unlock the thread; the caller waits for cleared so it knows the machine
// is free to sleep again by the time Release returns.
func platformHold() (func(), error) {
	done := make(chan struct{})
	ready := make(chan error, 1)
	cleared := make(chan struct{})

	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(cleared)

		ret, _, _ := procSetThreadExecState.Call(esContinuous | esSystemRequired)
		if ret == 0 { // zero means the request failed
			ready <- errors.New("SetThreadExecutionState failed")
			return
		}
		ready <- nil

		<-done
		// ES_CONTINUOUS on its own clears the previous request, so the system
		// is allowed to sleep once this thread's state is gone.
		procSetThreadExecState.Call(esContinuous)
	}()

	if err := <-ready; err != nil {
		<-cleared // reap the goroutine before returning
		return nil, err
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			close(done)
			<-cleared
		})
	}, nil
}
