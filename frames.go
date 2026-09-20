package main

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const frameTimeout = 20 * time.Second

// extractFrame grabs one JPEG frame straight from a file at the given time —
// used for the untouched source, and for a finished job's actual output.
func extractFrame(ctx context.Context, ffmpegBin, path string, atSeconds float64, width int) ([]byte, error) {
	return runFrameExtract(ctx, ffmpegBin, path, atSeconds, width, "")
}

// extractPreviewFrame applies a spec's video filters (crop, scale, deinterlace,
// rotate and so on) before grabbing the frame, so it shows what an encode
// would look like without waiting for one. It does not reproduce whatever the
// chosen codec's compression would do to the picture.
func extractPreviewFrame(ctx context.Context, ffmpegBin, path string, atSeconds float64, width int, spec Spec) ([]byte, error) {
	return runFrameExtract(ctx, ffmpegBin, path, atSeconds, width, filterChain(spec, path))
}

func runFrameExtract(ctx context.Context, ffmpegBin, path string, atSeconds float64, width int, vf string) ([]byte, error) {
	if atSeconds < 0 {
		atSeconds = 0
	}
	ctx, cancel := context.WithTimeout(ctx, frameTimeout)
	defer cancel()

	// Seek in two steps: a fast, keyframe-aligned seek before -i gets close,
	// then a short precise seek after -i lands on the exact frame without
	// decoding the whole file from the start.
	coarse := math.Max(0, atSeconds-10)
	fine := atSeconds - coarse

	args := []string{"-hide_banner", "-nostdin", "-loglevel", "error",
		"-ss", trimFloat(coarse), "-i", path, "-ss", trimFloat(fine)}

	filters := vf
	if width > 0 {
		scale := fmt.Sprintf("scale=%d:-2:flags=lanczos", width)
		if filters != "" {
			filters += "," + scale
		} else {
			filters = scale
		}
	}
	if filters != "" {
		args = append(args, "-vf", filters)
	}
	args = append(args, "-frames:v", "1", "-q:v", "2", "-f", "mjpeg", "pipe:1")

	cmd := exec.CommandContext(ctx, ffmpegBin, args...)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("could not read a frame: %s", firstLine(msg))
	}
	if out.Len() == 0 {
		return nil, fmt.Errorf("no frame at that time — it may be past the end of the video")
	}
	return out.Bytes(), nil
}

// ---- frame cache ----
//
// Scrubbing a timeline or reopening a preview re-requests the same handful of
// frames constantly. Each one costs a real ffmpeg process, so a small cache
// keyed by exactly what would change the output (the file's identity, the
// timestamp, the width, and any filters applied) turns repeat requests into a
// map lookup. A file being re-encoded gets a new mtime/size, so its cache
// entries fall out on their own rather than serving stale frames.
type frameCache struct {
	mu       sync.Mutex
	entries  map[string][]byte
	order    []string
	curBytes int64
	maxBytes int64
}

func newFrameCache(maxBytes int64) *frameCache {
	return &frameCache{entries: map[string][]byte{}, maxBytes: maxBytes}
}

func (c *frameCache) getOrCompute(key string, compute func() ([]byte, error)) ([]byte, error) {
	c.mu.Lock()
	if data, ok := c.entries[key]; ok {
		c.mu.Unlock()
		return data, nil
	}
	c.mu.Unlock()

	data, err := compute()
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	if _, exists := c.entries[key]; !exists {
		c.entries[key] = data
		c.order = append(c.order, key)
		c.curBytes += int64(len(data))
		for c.curBytes > c.maxBytes && len(c.order) > 0 {
			oldest := c.order[0]
			c.order = c.order[1:]
			if old, ok := c.entries[oldest]; ok {
				c.curBytes -= int64(len(old))
				delete(c.entries, oldest)
			}
		}
	}
	c.mu.Unlock()
	return data, nil
}

func frameCacheKey(path string, mtimeUnixNano, size int64, atSeconds float64, width int, filters string) string {
	return fmt.Sprintf("%s|%d|%d|%.2f|%d|%s", path, mtimeUnixNano, size, atSeconds, width, filters)
}

// cachedFrame looks up a frame by the file's current identity before falling
// back to compute. If the file can't be stat'd, it just computes directly —
// caching is an optimization, never a requirement for correctness.
func (s *server) cachedFrame(path string, atSeconds float64, width int, filters string, compute func() ([]byte, error)) ([]byte, error) {
	st, err := os.Stat(path)
	if err != nil {
		return compute()
	}
	key := frameCacheKey(path, st.ModTime().UnixNano(), st.Size(), atSeconds, width, filters)
	return s.frames.getOrCompute(key, compute)
}
