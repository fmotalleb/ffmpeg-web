//go:build unix

package main

import (
	"os"
	"syscall"
)

// setProcessFrozen holds a process still in place, or lets it run on again.
// SIGSTOP and SIGCONT are the unix way to pause a program without touching
// what it is working on: the process keeps every bit of its state, writes
// nothing while stopped, and continues from exactly where it was signaled.
// Best effort — a process that has just exited cannot be signaled, and that
// needs no handling.
func setProcessFrozen(pid int, frozen bool) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	sig := syscall.SIGCONT
	if frozen {
		sig = syscall.SIGSTOP
	}
	return p.Signal(sig)
}
