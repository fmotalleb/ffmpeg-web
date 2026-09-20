package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// MediaInfo is the trimmed-down view of ffprobe output that the UI needs.
type MediaInfo struct {
	Path      string      `json:"path"`
	Name      string      `json:"name"`
	Size      int64       `json:"size"`
	Duration  float64     `json:"duration"`
	Container string      `json:"container"`
	Bitrate   int64       `json:"bitrate"`
	Video     *VideoTrack `json:"video"`
	Audio     []Track     `json:"audio"`
	Subtitles []Track     `json:"subtitles"`
}

type VideoTrack struct {
	Codec       string  `json:"codec"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	FPS         float64 `json:"fps"`
	PixelFormat string  `json:"pixelFormat"`
	Interlaced  bool    `json:"interlaced"`
}

type Track struct {
	Index    int    `json:"index"`
	Codec    string `json:"codec"`
	Language string `json:"language"`
	Title    string `json:"title"`
	Channels int    `json:"channels"`
	Default  bool   `json:"default"`
}

type probeOutput struct {
	Format struct {
		FormatName string            `json:"format_name"`
		Duration   string            `json:"duration"`
		Size       string            `json:"size"`
		BitRate    string            `json:"bit_rate"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		Index          int               `json:"index"`
		CodecName      string            `json:"codec_name"`
		CodecType      string            `json:"codec_type"`
		Width          int               `json:"width"`
		Height         int               `json:"height"`
		PixFmt         string            `json:"pix_fmt"`
		FieldOrder     string            `json:"field_order"`
		Channels       int               `json:"channels"`
		AvgFrameRate   string            `json:"avg_frame_rate"`
		RFrameRate     string            `json:"r_frame_rate"`
		Duration       string            `json:"duration"`
		Disposition    map[string]int    `json:"disposition"`
		Tags           map[string]string `json:"tags"`
		NBFrames       string            `json:"nb_frames"`
		CodecLongName  string            `json:"codec_long_name"`
		SampleRateText string            `json:"sample_rate"`
	} `json:"streams"`
}

func probe(ctx context.Context, ffprobeBin, path string) (*MediaInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := execCMD(ctx, ffprobeBin,
		"-v", "error", "-print_format", "json",
		"-show_format", "-show_streams", path)
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(ee.Stderr) > 0 {
			return nil, fmt.Errorf("ffprobe: %s", strings.TrimSpace(string(ee.Stderr)))
		}
		return nil, fmt.Errorf("ffprobe: %w", err)
	}

	var raw probeOutput
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("ffprobe returned unreadable JSON: %w", err)
	}

	info := &MediaInfo{
		Path:      path,
		Name:      filepath.Base(path),
		Container: raw.Format.FormatName,
		Audio:     []Track{},
		Subtitles: []Track{},
	}
	info.Duration, _ = strconv.ParseFloat(raw.Format.Duration, 64)
	info.Size, _ = strconv.ParseInt(raw.Format.Size, 10, 64)
	info.Bitrate, _ = strconv.ParseInt(raw.Format.BitRate, 10, 64)

	audioN, subN := 0, 0
	for _, st := range raw.Streams {
		tags := st.Tags
		if tags == nil {
			tags = map[string]string{}
		}
		switch st.CodecType {
		case "video":
			if st.Disposition["attached_pic"] == 1 || info.Video != nil {
				continue
			}
			info.Video = &VideoTrack{
				Codec:       st.CodecName,
				Width:       st.Width,
				Height:      st.Height,
				FPS:         parseRate(st.AvgFrameRate, st.RFrameRate),
				PixelFormat: st.PixFmt,
				Interlaced:  st.FieldOrder != "" && st.FieldOrder != "progressive",
			}
		case "audio":
			info.Audio = append(info.Audio, Track{
				Index: audioN, Codec: st.CodecName, Language: tags["language"],
				Title: tags["title"], Channels: st.Channels,
				Default: st.Disposition["default"] == 1,
			})
			audioN++
		case "subtitle":
			info.Subtitles = append(info.Subtitles, Track{
				Index: subN, Codec: st.CodecName, Language: tags["language"],
				Title: tags["title"], Default: st.Disposition["default"] == 1,
			})
			subN++
		}
	}
	if info.Duration == 0 && info.Video != nil {
		for _, st := range raw.Streams {
			if st.CodecType == "video" {
				info.Duration, _ = strconv.ParseFloat(st.Duration, 64)
				break
			}
		}
	}
	return info, nil
}

// parseRate turns ffprobe's "30000/1001" fractions into a float.
func parseRate(candidates ...string) float64 {
	for _, c := range candidates {
		num, den, ok := strings.Cut(c, "/")
		if !ok {
			if v, err := strconv.ParseFloat(c, 64); err == nil && v > 0 {
				return v
			}
			continue
		}
		n, err1 := strconv.ParseFloat(num, 64)
		d, err2 := strconv.ParseFloat(den, 64)
		if err1 == nil && err2 == nil && d != 0 && n != 0 {
			return n / d
		}
	}
	return 0
}

// probeRaw returns ffprobe's full report, for the "show me everything" view.
func probeRaw(ctx context.Context, ffprobeBin, path string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := execCMD(ctx, ffprobeBin,
		"-v", "error", "-print_format", "json",
		"-show_format", "-show_streams", "-show_chapters", "-show_programs", path)
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(ee.Stderr) > 0 {
			return nil, fmt.Errorf("ffprobe: %s", strings.TrimSpace(string(ee.Stderr)))
		}
		return nil, fmt.Errorf("ffprobe: %w", err)
	}
	return out, nil
}
