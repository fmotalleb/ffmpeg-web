package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// verifyOutput re-probes a finished file and checks it is actually playable:
// ffprobe has to parse it, there has to be a video stream, and the length has
// to match what was asked for. A truncated encode passes none of those.
func verifyOutput(ctx context.Context, ffmpegBin, ffprobeBin, path string, expected float64) (string, error) {
	st, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("the output file is missing")
	}
	if st.Size() < 1024 {
		return "", fmt.Errorf("the output file is empty")
	}

	info, err := probe(ctx, ffprobeBin, path)
	if err != nil {
		return "", fmt.Errorf("the output file will not open: %w", err)
	}
	if info.Video == nil || info.Video.Width == 0 {
		return "", fmt.Errorf("the output file has no usable video track")
	}
	if info.Duration <= 0 {
		return "", fmt.Errorf("the output file reports no length, so it is probably truncated")
	}

	note := fmt.Sprintf("%s, %dx%d, %s",
		info.Video.Codec, info.Video.Width, info.Video.Height, formatSeconds(info.Duration))

	if expected > 0 {
		drift := math.Abs(info.Duration-expected) / expected
		if drift > 0.02 && math.Abs(info.Duration-expected) > 1.5 {
			return note, fmt.Errorf("the output is %s long but %s was expected — it looks truncated",
				formatSeconds(info.Duration), formatSeconds(expected))
		}
	}
	// A decode pass over the last chunk catches containers that index fine but
	// hold broken frames at the tail, which is where interrupted writes land.
	if err := decodeTail(ctx, ffmpegBin, path, info.Duration); err != nil {
		return note, err
	}
	return note, nil
}

func decodeTail(ctx context.Context, ffmpegBin, path string, duration float64) error {
	start := math.Max(0, duration-5)
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	cmd := execCMD(ctx, ffmpegBin, "-v", "error", "-nostdin",
		"-ss", trimFloat(start), "-i", path, "-t", "5", "-f", "null", nullDevice)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("the end of the file does not decode: %s", msg)
	}
	return nil
}

func formatSeconds(s float64) string {
	d := time.Duration(s * float64(time.Second)).Round(time.Second)
	return d.String()
}

// ---- post-queue hooks ----

type hookRunner struct {
	allowCommands bool
	outDir        string
}

// Run fires the hook the user configured for "the queue is empty again".
func (h *hookRunner) Run(hook Hook, summary map[string]any) {
	switch hook.Type {
	case "", "none":
		return
	case "webhook":
		h.webhook(hook.URL, summary)
	case "command":
		h.command(hook.Command, summary)
	default:
		log.Printf("unknown post-queue action %q", hook.Type)
	}
}

func (h *hookRunner) webhook(url string, summary map[string]any) {
	if url == "" {
		return
	}
	body, _ := json.Marshal(summary)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		log.Printf("post-queue webhook: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("post-queue webhook: %v", err)
		return
	}
	res.Body.Close()
	log.Printf("post-queue webhook returned %s", res.Status)
}

func (h *hookRunner) command(line string, summary map[string]any) {
	if strings.TrimSpace(line) == "" {
		return
	}
	if !h.allowCommands {
		log.Printf("post-queue command is set but the server was started without -allow-commands")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = execCMD(ctx, "cmd", "/C", line)
	} else {
		cmd = execCMD(ctx, "/bin/sh", "-c", line)
	}
	cmd.Dir = h.outDir
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("TRANSCODER_DONE=%v", summary["done"]),
		fmt.Sprintf("TRANSCODER_FAILED=%v", summary["failed"]),
		fmt.Sprintf("TRANSCODER_OUTDIR=%s", h.outDir),
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("post-queue command failed: %v: %s", err, strings.TrimSpace(string(out)))
		return
	}
	log.Printf("post-queue command finished: %s", strings.TrimSpace(string(out)))
}
