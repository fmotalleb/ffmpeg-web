package main

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	frameTimeout   = 20 * time.Second
	clipTimeout    = 30 * time.Second
	defaultClipDur = 0.5
)

// extractFrame grabs one JPEG frame straight from a file at the given time —
// used for the untouched source, and for a finished job's actual output.
func extractFrame(ctx context.Context, ffmpegBin, path string, atSeconds float64, width int) ([]byte, error) {
	return runFrameExtract(ctx, ffmpegBin, path, atSeconds, width, "")
}

// previewEncodeFrames is how many frames the preview encoder produces.
// Sixty frames guarantees at least 0.5 s of video at any frame rate,
// giving the encoder enough context (B-frames, rate control) while
// staying fast.
const previewEncodeFrames = 60

// encodePreviewFrame encodes a short segment around atSeconds using the
// full spec (codec, bitrate, quality, filters) into a temporary file, then
// extracts a single JPEG frame from it. The result shows what the final
// encode will actually look like, including compression artifacts.
func encodePreviewFrame(ctx context.Context, ffmpegBin, path string, atSeconds float64, width int, spec Spec, workDir string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	tmp, err := os.CreateTemp(workDir, "preview-*.mp4")
	if err != nil {
		return nil, fmt.Errorf("cannot create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpPath)

	// Set Trim so buildArgs places -ss before -i for fast seeking.
	seekSpec := spec
	seekSpec.Trim.Enabled = true
	seekSpec.Trim.Start = math.Max(0, atSeconds-0.5)
	seekSpec.Trim.End = 0 // no duration limit; -frames:v stops the encode

	args, err := buildArgs(seekSpec, path, tmpPath, "", 0)
	if err != nil {
		return nil, err
	}

	// Insert -frames:v N before the output path (last arg) to cap the encode.
	output := args[len(args)-1]
	args = args[:len(args)-1]
	args = append(args, "-frames:v", strconv.Itoa(previewEncodeFrames), output)

	cmd := execCMD(ctx, ffmpegBin, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("preview encode failed: %s", msg)
	}

	// Extract the middle frame by frame number — exact alignment regardless
	// of frame rate.
	targetFrame := previewEncodeFrames / 2
	selectFilter := "select=eq(n\\," + strconv.Itoa(targetFrame) + ")"
	if width > 0 {
		selectFilter += fmt.Sprintf(",scale=%d:-2:flags=lanczos", width)
	}
	frameArgs := []string{
		"-hide_banner", "-nostdin", "-loglevel", "error",
		"-i", tmpPath,
		"-vf", selectFilter,
		"-frames:v", "1",
		// "-vsync", "0",
		"-q:v", "2",
		"-strict", "-1",
		"-f", "mjpeg", "pipe:1",
	}
	frameCmd := execCMD(ctx, ffmpegBin, frameArgs...)
	var frameOut, frameStderr bytes.Buffer
	frameCmd.Stdout = &frameOut
	frameCmd.Stderr = &frameStderr
	if err := frameCmd.Run(); err != nil {
		msg := strings.TrimSpace(frameStderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("could not read a frame: %s", msg)
	}
	if frameOut.Len() == 0 {
		return nil, fmt.Errorf("no frame at that time — it may be past the end of the video")
	}
	return frameOut.Bytes(), nil
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
	args = append(args, "-frames:v", "1", "-q:v", "2", "-strict", "-1", "-f", "mjpeg", "pipe:1")

	cmd := execCMD(ctx, ffmpegBin, args...)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("could not read a frame: %s", msg)
	}
	if out.Len() == 0 {
		return nil, fmt.Errorf("no frame at that time — it may be past the end of the video")
	}
	return out.Bytes(), nil
}

// ---- clip extraction ----

// extractClip cuts a short segment from a file starting at atSeconds,
// copying streams without re-encoding. The result is an MP4 suitable for
// inline browser playback.
func extractClip(ctx context.Context, ffmpegBin, path string, atSeconds, duration float64, width int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, clipTimeout)
	defer cancel()

	tmp, err := os.CreateTemp("", "clip-*.mp4")
	if err != nil {
		return nil, fmt.Errorf("cannot create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpPath)

	args := []string{"-hide_banner", "-nostdin", "-y", "-loglevel", "error",
		"-ss", trimFloat(atSeconds), "-t", trimFloat(duration), "-i", path,
		"-map", "0:v:0?",
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
		"-an"}
	if width > 0 {
		args = append(args, "-vf", fmt.Sprintf("scale=%d:-2:flags=lanczos", width))
	}
	args = append(args, tmpPath)

	cmd := execCMD(ctx, ffmpegBin, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("could not extract clip: %s", msg)
	}

	data, err := os.ReadFile(tmpPath)
	if err != nil {
		return nil, fmt.Errorf("cannot read clip: %w", err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("no clip data at that time")
	}
	return data, nil
}

// encodePreviewClip encodes a short segment around atSeconds using the
// full spec (codec, bitrate, quality, filters) into an MP4 clip.
func encodePreviewClip(ctx context.Context, ffmpegBin, path string, atSeconds, duration float64, spec Spec, workDir string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, clipTimeout)
	defer cancel()

	tmp, err := os.CreateTemp(workDir, "preview-clip-*.mp4")
	if err != nil {
		return nil, fmt.Errorf("cannot create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpPath)

	seekSpec := spec
	seekSpec.Trim.Enabled = true
	seekSpec.Trim.Start = atSeconds
	seekSpec.Trim.End = atSeconds + duration

	args, err := buildArgs(seekSpec, path, tmpPath, "", 0)
	if err != nil {
		return nil, err
	}

	cmd := execCMD(ctx, ffmpegBin, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("preview clip encode failed: %s", msg)
	}

	data, err := os.ReadFile(tmpPath)
	if err != nil {
		return nil, fmt.Errorf("cannot read preview clip: %w", err)
	}
	return data, nil
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
