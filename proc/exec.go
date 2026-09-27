// Package proc runs external commands and controls their execution: it is the
// one place that knows how to start a child process and how to hold one still.
package proc

import (
	"context"
	"os"
	"os/exec"

	"github.com/fmotalleb/go-tools/log"
	"go.uber.org/zap"
)

// NullDevice is the platform's sink for discarded output. It is a variable so
// the few places that pipe frames into nothing share one value.
var NullDevice = os.DevNull

// Exec logs every external command it starts under the "exec" logger read
// from the context, then builds the command.
func Exec(ctx context.Context, name string, arg ...string) *exec.Cmd {
	log.FromContext(ctx).Named("exec").Debug("starting command",
		zap.String("binary", name), zap.Strings("args", arg))
	return exec.CommandContext(ctx, name, arg...)
}
