package main

import (
	"context"
	"log"
	"os/exec"
)

func execCMD(ctx context.Context, name string, arg ...string) *exec.Cmd {
	log.Printf("exec	%s %s", name, arg)
	return exec.CommandContext(ctx, name, arg...)
}
