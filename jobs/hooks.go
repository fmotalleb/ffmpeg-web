package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/fmotalleb/ffmpeg-web/proc"
	"github.com/fmotalleb/ffmpeg-web/storage"
)

// HookRunner fires the action the user configured for "the queue is empty
// again". It is deliberately tiny: an empty queue is a rare event, so all the
// work happens when it does.
type HookRunner struct {
	Log           *zap.Logger
	AllowCommands bool
	OutDir        string
}

// NewHookRunner builds the runner with the flags the server was started with.
func NewHookRunner(log *zap.Logger, allowCommands bool, outDir string) *HookRunner {
	return &HookRunner{Log: log, AllowCommands: allowCommands, OutDir: outDir}
}

// Run fires the hook the user configured for "the queue is empty again".
func (h *HookRunner) Run(hook storage.Hook, summary map[string]any) {
	switch hook.Type {
	case "", "none":
		return
	case "webhook":
		h.webhook(hook.URL, summary)
	case "command":
		h.command(hook.Command, summary)
	default:
		h.Log.Warn("unknown post-queue action", zap.String("type", hook.Type))
	}
}

func (h *HookRunner) webhook(url string, summary map[string]any) {
	if url == "" {
		return
	}
	body, _ := json.Marshal(summary)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		h.Log.Error("post-queue webhook could not be built", zap.String("url", url), zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		h.Log.Error("post-queue webhook failed", zap.String("url", url), zap.Error(err))
		return
	}
	res.Body.Close()
	h.Log.Info("post-queue webhook returned", zap.String("status", res.Status))
}

func (h *HookRunner) command(line string, summary map[string]any) {
	if strings.TrimSpace(line) == "" {
		return
	}
	if !h.AllowCommands {
		h.Log.Warn("post-queue command is set but the server was started without -allow-commands")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = proc.Exec(ctx, "cmd", "/C", line)
	} else {
		cmd = proc.Exec(ctx, "/bin/sh", "-c", line)
	}
	cmd.Dir = h.OutDir
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("TRANSCODER_DONE=%v", summary["done"]),
		fmt.Sprintf("TRANSCODER_FAILED=%v", summary["failed"]),
		fmt.Sprintf("TRANSCODER_OUTDIR=%s", h.OutDir),
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		h.Log.Error("post-queue command failed",
			zap.Error(err), zap.String("output", strings.TrimSpace(string(out))))
		return
	}
	h.Log.Info("post-queue command finished", zap.String("output", strings.TrimSpace(string(out))))
}
