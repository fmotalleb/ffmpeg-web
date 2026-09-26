//go:build windows

package main

import (
	"fmt"
	"syscall"
)

// Windows has no SIGSTOP, so pausing uses the same ntdll calls Task Manager's
// "Suspend"/"Resume" is built on: they stop the process's threads in place and
// start them again, leaving open files, buffers and encoder state untouched.
var (
	ntdll            = syscall.NewLazyDLL("ntdll.dll")
	ntSuspendProcess = ntdll.NewProc("NtSuspendProcess")
	ntResumeProcess  = ntdll.NewProc("NtResumeProcess")
)

// processSuspendResume is the access right suspend/resume needs; the syscall
// package does not name it.
const processSuspendResume = 0x0800

// setProcessFrozen holds a process still in place, or lets it run on again.
// Best effort — a process that has just exited cannot be signaled, and that
// needs no handling.
func setProcessFrozen(pid int, frozen bool) error {
	h, err := syscall.OpenProcess(processSuspendResume, false, uint32(pid))
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(h)
	proc := ntResumeProcess
	if frozen {
		proc = ntSuspendProcess
	}
	ret, _, callErr := proc.Call(uintptr(h))
	if ret != 0 { // NTSTATUS: 0 is the only success
		if callErr != nil {
			return callErr
		}
		return fmt.Errorf("could not freeze process %d: NTSTATUS %d", pid, ret)
	}
	return nil
}
