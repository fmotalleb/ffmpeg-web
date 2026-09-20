package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Spec is the full description of one encode, as sent by the UI.
type Spec struct {
	Input       string       `json:"input"`
	OutputName  string       `json:"outputName"`
	Container   string       `json:"container"` // mp4 | mkv | webm
	WebOptimize bool         `json:"webOptimize"`
	Video       VideoSpec    `json:"video"`
	Audio       AudioSpec    `json:"audio"`
	Picture     PictureSpec  `json:"picture"`
	Filters     FilterSpec   `json:"filters"`
	Subtitle    SubtitleSpec `json:"subtitle"`
	Trim        TrimSpec     `json:"trim"`
	Extra       ExtraSpec    `json:"extra"`
}

// ExtraSpec is the escape hatch: whatever the panels do not cover, typed in by
// hand. HandBrake calls this "additional options".
type ExtraSpec struct {
	EncoderOptions string `json:"encoderOptions"` // x264/x265/svtav1 params, "key=value:key=value"
	InputArgs      string `json:"inputArgs"`      // raw ffmpeg args placed before -i
	OutputArgs     string `json:"outputArgs"`     // raw ffmpeg args placed before the output file
}

type VideoSpec struct {
	Encoder  string  `json:"encoder"`  // x264 | x265 | vp9 | av1 | copy
	RateMode string  `json:"rateMode"` // quality | bitrate
	Quality  float64 `json:"quality"`  // CRF / CQ
	Bitrate  int     `json:"bitrate"`  // kbit/s
	TwoPass  bool    `json:"twoPass"`
	Speed    string  `json:"speed"` // veryslow…ultrafast
	Profile  string  `json:"profile"`
	Level    string  `json:"level"`
	Tune     string  `json:"tune"`
	FPSMode  string  `json:"fpsMode"` // same | peak | constant
	FPS      string  `json:"fps"`
	GOP      int     `json:"gop"` // keyframe interval in frames, 0 = encoder default
}

type AudioSpec struct {
	Encoder    string  `json:"encoder"` // aac | opus | mp3 | ac3 | flac | copy | none
	Track      int     `json:"track"`   // 0-based audio stream index
	Bitrate    int     `json:"bitrate"` // kbit/s
	Mixdown    string  `json:"mixdown"` // source | mono | stereo | 5.1
	SampleRate int     `json:"sampleRate"`
	Gain       float64 `json:"gain"` // dB
	Normalize  bool    `json:"normalize"`
}

type PictureSpec struct {
	ScaleMode   string `json:"scaleMode"` // source | custom
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	KeepAspect  bool   `json:"keepAspect"`
	Pad         bool   `json:"pad"` // letterbox to exact WxH instead of shrinking
	CropTop     int    `json:"cropTop"`
	CropBottom  int    `json:"cropBottom"`
	CropLeft    int    `json:"cropLeft"`
	CropRight   int    `json:"cropRight"`
	CropDetect  bool   `json:"cropDetect"`
	PixelFormat string `json:"pixelFormat"` // "" | yuv420p | yuv420p10le
}

type FilterSpec struct {
	Deinterlace string `json:"deinterlace"` // off | yadif | bwdif
	Denoise     string `json:"denoise"`     // off | light | medium | strong
	Sharpen     bool   `json:"sharpen"`
	Deblock     bool   `json:"deblock"`
	Rotate      int    `json:"rotate"` // 0 | 90 | 180 | 270
	FlipH       bool   `json:"flipH"`
	Grayscale   bool   `json:"grayscale"`
}

type SubtitleSpec struct {
	Mode  string `json:"mode"`  // none | copy | burn
	Track int    `json:"track"` // 0-based subtitle stream index
}

type TrimSpec struct {
	Enabled bool    `json:"enabled"`
	Start   float64 `json:"start"` // seconds
	End     float64 `json:"end"`   // seconds
}

var videoEncoders = map[string]string{
	"x264": "libx264",
	"x265": "libx265",
	"vp9":  "libvpx-vp9",
	"av1":  "libsvtav1",
	"copy": "copy",
}

var audioEncoders = map[string]string{
	"aac":  "aac",
	"opus": "libopus",
	"mp3":  "libmp3lame",
	"ac3":  "ac3",
	"flac": "flac",
	"copy": "copy",
}

// svtav1 takes a numeric preset; map the familiar x264 words onto it.
var av1Presets = map[string]string{
	"veryslow": "3", "slower": "4", "slow": "5", "medium": "7",
	"fast": "8", "faster": "9", "veryfast": "10", "ultrafast": "12",
}

// libvpx uses -cpu-used 0..8 (higher = faster).
var vp9CPUUsed = map[string]string{
	"veryslow": "0", "slower": "1", "slow": "2", "medium": "3",
	"fast": "4", "faster": "5", "veryfast": "6", "ultrafast": "8",
}

func mixdownChannels(m string) string {
	switch m {
	case "mono":
		return "1"
	case "stereo":
		return "2"
	case "5.1":
		return "6"
	}
	return ""
}

// filterChain assembles the -vf graph. Returns "" when no video filtering is needed.
func filterChain(s Spec, input string) string {
	p, f := s.Picture, s.Filters
	var chain []string

	switch f.Deinterlace {
	case "yadif":
		chain = append(chain, "yadif=mode=0")
	case "bwdif":
		chain = append(chain, "bwdif=mode=0")
	}

	if p.CropDetect {
		// cropdetect only prints suggestions; the real crop still comes from the numbers.
		chain = append(chain, "cropdetect=24:2:0")
	}
	if p.CropTop|p.CropBottom|p.CropLeft|p.CropRight != 0 {
		chain = append(chain, fmt.Sprintf("crop=in_w-%d:in_h-%d:%d:%d",
			p.CropLeft+p.CropRight, p.CropTop+p.CropBottom, p.CropLeft, p.CropTop))
	}

	switch f.Denoise {
	case "light":
		chain = append(chain, "hqdn3d=1:1:6:6")
	case "medium":
		chain = append(chain, "hqdn3d=3:2:8:8")
	case "strong":
		chain = append(chain, "hqdn3d=6:4:12:12")
	}
	if f.Deblock {
		chain = append(chain, "deblock=filter=weak:block=4")
	}
	if f.Sharpen {
		chain = append(chain, "unsharp=5:5:0.8:3:3:0.4")
	}

	switch f.Rotate {
	case 90:
		chain = append(chain, "transpose=1")
	case 180:
		chain = append(chain, "transpose=1,transpose=1")
	case 270:
		chain = append(chain, "transpose=2")
	}
	if f.FlipH {
		chain = append(chain, "hflip")
	}
	if f.Grayscale {
		chain = append(chain, "format=gray")
	}

	if p.ScaleMode == "custom" && p.Width > 0 && p.Height > 0 {
		if p.KeepAspect {
			chain = append(chain, fmt.Sprintf(
				"scale=%d:%d:force_original_aspect_ratio=decrease:flags=lanczos", p.Width, p.Height))
			if p.Pad {
				chain = append(chain, fmt.Sprintf(
					"pad=%d:%d:(ow-iw)/2:(oh-ih)/2:black", p.Width, p.Height))
			}
		} else {
			chain = append(chain, fmt.Sprintf("scale=%d:%d:flags=lanczos", p.Width, p.Height))
		}
		// Most encoders reject odd dimensions.
		chain = append(chain, "scale=trunc(iw/2)*2:trunc(ih/2)*2")
	}

	if s.Subtitle.Mode == "burn" {
		chain = append(chain, fmt.Sprintf("subtitles=%s:si=%d",
			escapeFilterPath(input), s.Subtitle.Track))
	}
	if p.PixelFormat != "" {
		chain = append(chain, "format="+p.PixelFormat)
	}

	return strings.Join(chain, ",")
}

// escapeFilterPath quotes a path for use inside a filter argument.
func escapeFilterPath(p string) string {
	r := strings.NewReplacer(`\`, `\\`, `:`, `\:`, `'`, `\'`, `[`, `\[`, `]`, `\]`, `,`, `\,`)
	return "'" + r.Replace(p) + "'"
}

func audioFilterChain(a AudioSpec) string {
	var chain []string
	if a.Normalize {
		chain = append(chain, "loudnorm=I=-16:TP=-1.5:LRA=11")
	}
	if a.Gain != 0 {
		chain = append(chain, fmt.Sprintf("volume=%sdB", trimFloat(a.Gain)))
	}
	return strings.Join(chain, ",")
}

func trimFloat(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// buildArgs renders the ffmpeg command line.
// pass is 0 for a single-pass encode, or 1/2 for two-pass ABR.
func buildArgs(s Spec, input, output, passLog string, pass int) ([]string, error) {
	args := []string{"-hide_banner", "-nostdin", "-y", "-loglevel", "error",
		"-progress", "pipe:1", "-nostats"}

	inputExtra, err := splitArgs(s.Extra.InputArgs)
	if err != nil {
		return nil, fmt.Errorf("input options: %w", err)
	}
	outputExtra, err := splitArgs(s.Extra.OutputArgs)
	if err != nil {
		return nil, fmt.Errorf("output options: %w", err)
	}
	for _, list := range [][]string{inputExtra, outputExtra} {
		if err := rejectReservedArgs(list); err != nil {
			return nil, err
		}
	}
	args = append(args, inputExtra...)

	if s.Trim.Enabled && s.Trim.Start > 0 {
		args = append(args, "-ss", trimFloat(s.Trim.Start))
	}
	args = append(args, "-i", input)
	if s.Trim.Enabled && s.Trim.End > s.Trim.Start {
		args = append(args, "-t", trimFloat(s.Trim.End-s.Trim.Start))
	}

	args = append(args, "-map", "0:v:0?")
	audioOn := s.Audio.Encoder != "none" && pass != 1
	if audioOn {
		args = append(args, "-map", fmt.Sprintf("0:a:%d?", s.Audio.Track))
	}
	subsCopied := s.Subtitle.Mode == "copy" && s.Container != "webm" && pass != 1
	if subsCopied {
		args = append(args, "-map", fmt.Sprintf("0:s:%d?", s.Subtitle.Track))
	}

	// ---- video ----
	enc := videoEncoders[s.Video.Encoder]
	if enc == "" {
		enc = "libx264"
	}
	if vf := filterChain(s, input); vf != "" && enc != "copy" {
		args = append(args, "-vf", vf)
	}
	args = append(args, "-c:v", enc)

	if enc != "copy" {
		switch enc {
		case "libx264", "libx265":
			args = append(args, "-preset", orDefault(s.Video.Speed, "medium"))
			if s.Video.Tune != "" && s.Video.Tune != "none" {
				args = append(args, "-tune", s.Video.Tune)
			}
		case "libsvtav1":
			args = append(args, "-preset", orDefault(av1Presets[s.Video.Speed], "7"))
		case "libvpx-vp9":
			args = append(args, "-cpu-used", orDefault(vp9CPUUsed[s.Video.Speed], "3"),
				"-row-mt", "1", "-deadline", "good")
		}

		if opts := strings.TrimSpace(s.Extra.EncoderOptions); opts != "" {
			if flag := encoderParamFlag[enc]; flag != "" {
				args = append(args, flag, opts)
			} else {
				return nil, fmt.Errorf("%s does not take an options string — put those in the extra output options instead", s.Video.Encoder)
			}
		}

		if s.Video.RateMode == "bitrate" && s.Video.Bitrate > 0 {
			br := strconv.Itoa(s.Video.Bitrate) + "k"
			args = append(args, "-b:v", br, "-maxrate", br,
				"-bufsize", strconv.Itoa(s.Video.Bitrate*2)+"k")
		} else {
			q := trimFloat(math.Round(s.Video.Quality*10) / 10)
			switch enc {
			case "libvpx-vp9":
				args = append(args, "-crf", q, "-b:v", "0")
			case "libsvtav1":
				args = append(args, "-crf", q)
			default:
				args = append(args, "-crf", q)
			}
		}

		if s.Video.Profile != "" && s.Video.Profile != "auto" {
			args = append(args, "-profile:v", s.Video.Profile)
		}
		if s.Video.Level != "" && s.Video.Level != "auto" && (enc == "libx264" || enc == "libx265") {
			args = append(args, "-level", s.Video.Level)
		}
		if s.Video.GOP > 0 {
			args = append(args, "-g", strconv.Itoa(s.Video.GOP))
		}
		switch s.Video.FPSMode {
		case "constant":
			if s.Video.FPS != "" {
				args = append(args, "-r", s.Video.FPS, "-fps_mode", "cfr")
			}
		case "peak":
			if s.Video.FPS != "" {
				args = append(args, "-fpsmax", s.Video.FPS)
			}
		}
	}

	// ---- two-pass ----
	if pass > 0 {
		args = append(args, "-pass", strconv.Itoa(pass), "-passlogfile", passLog)
	}

	// ---- audio ----
	switch {
	// The first pass of a two-pass run only measures the video: it keeps
	// no audio or subtitle track.
	case pass == 1:
		args = append(args, "-an", "-sn")
	case audioOn:
		aenc := audioEncoders[s.Audio.Encoder]
		if aenc == "" {
			aenc = "aac"
		}
		args = append(args, "-c:a", aenc)
		if aenc != "copy" {
			if s.Audio.Bitrate > 0 && aenc != "flac" {
				args = append(args, "-b:a", strconv.Itoa(s.Audio.Bitrate)+"k")
			}
			if ch := mixdownChannels(s.Audio.Mixdown); ch != "" {
				args = append(args, "-ac", ch)
			}
			if s.Audio.SampleRate > 0 {
				args = append(args, "-ar", strconv.Itoa(s.Audio.SampleRate))
			}
			if af := audioFilterChain(s.Audio); af != "" {
				args = append(args, "-af", af)
			}
		}
	default:
		args = append(args, "-an")
	}

	// ---- subtitles ----
	if subsCopied {
		if s.Container == "mp4" {
			args = append(args, "-c:s", "mov_text")
		} else {
			args = append(args, "-c:s", "copy")
		}
	} else if pass != 1 {
		args = append(args, "-sn")
	}

	if s.WebOptimize && s.Container == "mp4" && pass != 1 {
		args = append(args, "-movflags", "+faststart")
	}

	args = append(args, outputExtra...)

	if pass == 1 {
		args = append(args, "-f", "null", nullDevice)
	} else {
		args = append(args, output)
	}
	return args, nil
}

var encoderParamFlag = map[string]string{
	"libx264":   "-x264-params",
	"libx265":   "-x265-params",
	"libsvtav1": "-svtav1-params",
}

// reserved args would fight with the ones the server sets itself.
var reservedArgs = map[string]bool{
	"-i": true, "-progress": true, "-y": true, "-n": true, "-pass": true,
	"-passlogfile": true, "-nostats": true,
}

func rejectReservedArgs(args []string) error {
	for _, a := range args {
		if reservedArgs[strings.ToLower(a)] {
			return fmt.Errorf("%s is set by the server, so it cannot be passed as an extra option", a)
		}
	}
	return nil
}

// splitArgs breaks a typed-in options line into argv the way a shell would,
// honouring single and double quotes. Nothing is ever handed to a shell, so
// there is no command substitution to worry about — only quoting.
func splitArgs(line string) ([]string, error) {
	var (
		out     []string
		current strings.Builder
		quote   rune
		started bool
	)
	for _, r := range line {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				current.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote = r
			started = true
		case r == ' ' || r == '\t' || r == '\n':
			if started {
				out = append(out, current.String())
				current.Reset()
				started = false
			}
		default:
			current.WriteRune(r)
			started = true
		}
	}
	if quote != 0 {
		return nil, fmt.Errorf("unclosed %c quote", quote)
	}
	if started {
		out = append(out, current.String())
	}
	return out, nil
}

func orDefault(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}
