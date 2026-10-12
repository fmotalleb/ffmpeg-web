//go:build linux

package keepawake

import (
	"context"
	"errors"
	"os/exec"
	"sync"
	"syscall"
)

// platformHold asks logind to block sleep and idle while an encode runs, by
// holding a systemd-inhibit child alive.
//
// systemd-inhibit is part of systemd and present on essentially every Linux
// desktop, so this needs no extra dependency: the tool takes a command to run,
// holds an inhibition lock for its whole lifetime, and drops it the moment it
// exits. We run it around a bare "sleep", which does nothing but keep the lock
// held; releasing kills that child, and the kernel reaps it.
func platformHold(ctx context.Context) (func(), error) {
	path, err := exec.LookPath("systemd-inhibit")
	if err != nil {
		return nil, errors.New("systemd-inhibit not found (needed to keep the machine awake)")
	}

	cmd := exec.CommandContext(ctx,
		path,
		"--what=sleep:idle", // block suspend/hibernate and the idle screen
		"--who=ffmpeg-web",
		"--why=an encode is running",
		"--mode=block",
		"sleep", "infinity",
	)
	// Start the child's own session so the lock is dropped even if this
	// process is killed without a chance to clean up.
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
	cmd.Stdout, cmd.Stderr = nil, nil
	if err := cmd.Start(); err != nil {
		return nil, errors.New("could not start systemd-inhibit: " + err.Error())
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			// Killing the child releases the inhibition lock. Wait so the
			// process does not linger as a zombie.
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		})
	}, nil
}
