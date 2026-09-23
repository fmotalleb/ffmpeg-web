package main

import (
	"context"
	"os/exec"

	"github.com/fmotalleb/go-tools/log"
	"go.uber.org/zap"
)

// execCMD logs every external command it starts under the "exec" logger read
// from the context, then builds the command.
func execCMD(ctx context.Context, name string, arg ...string) *exec.Cmd {
	log.FromContext(ctx).Named("exec").Debug("starting command",
		zap.String("binary", name), zap.Strings("args", arg))
	return exec.CommandContext(ctx, name, arg...)
}
