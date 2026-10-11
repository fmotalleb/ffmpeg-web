package ffmpeg

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"os"
	"strings"
	"time"

	"github.com/fmotalleb/ffmpeg-web/probe"
	"github.com/fmotalleb/ffmpeg-web/proc"
)

// VerifyOutput re-probes a finished file and checks it is actually playable:
// ffprobe has to parse it, there has to be a video stream, and the length has
// to match what was asked for. A truncated encode passes none of those.
func VerifyOutput(ctx context.Context, ffmpegBin, ffprobeBin, path string, expected float64) (string, error) {
	st, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("the output file is missing")
	}
	if st.Size() < 1024 {
		return "", fmt.Errorf("the output file is empty")
	}

	info, err := probe.Probe(ctx, ffprobeBin, path)
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

	cmd := proc.Exec(ctx, ffmpegBin, "-v", "error", "-nostdin",
		"-ss", trimFloat(start), "-i", path, "-t", "5", "-f", "null", proc.NullDevice)
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
