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
	Library  string  `json:"library"`  // encoding library: sw | nvenc | qsv | vaapi | videotoolbox | amf
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

// resolveVideoEncoder turns the codec + library pair chosen in the UI into the
// ffmpeg encoder name, together with the library describing how to drive it.
func resolveVideoEncoder(v VideoSpec) (string, encoderLib) {
	if v.Encoder == "copy" {
		return "copy", encoderLib{}
	}
	lib, ok := resolveLibrary(v.Library, v.Encoder)
	if !ok {
		// Unknown codec: keep the historical default.
		lib, _ = resolveLibrary("sw", "x264")
		return videoEncoders["x264"], lib
	}
	if lib.engine == "software" {
		if enc := videoEncoders[v.Encoder]; enc != "" {
			return enc, lib
		}
		return videoEncoders["x264"], lib
	}
	return lib.FFmpeg, lib
}

// twoPassWanted reports whether the spec asks for a two-pass bitrate run and
// the chosen library can actually do one.
func twoPassWanted(spec Spec) bool {
	if !spec.Video.TwoPass || spec.Video.RateMode != "bitrate" || spec.Video.Encoder == "copy" {
		return false
	}
	_, lib := resolveVideoEncoder(spec.Video)
	return lib.SupportsTwoPass
}

// checkVideoEncoder refuses an encoder the local ffmpeg build does not have,
// so the user hears about it when the job is added instead of when it fails.
func checkVideoEncoder(enc string) error {
	if enc == "copy" || ffmpegVideoEncoders == nil || len(ffmpegVideoEncoders) == 0 {
		return nil
	}
	if !ffmpegVideoEncoders[enc] {
		return fmt.Errorf("this ffmpeg build has no %s encoder — pick another library", enc)
	}
	return nil
}

var audioEncoders = map[string]string{
	"aac":  "aac",
	"opus": "libopus",
	"mp3":  "libmp3lame",
	"ac3":  "ac3",
	"flac": "flac",
	"copy": "copy",
}

// Each hardware library has its own idea of a speed preset, so the familiar
// x264 words are translated into whatever that encoder understands.

// NVENC: p1 is fastest, p7 is slowest (and best).
var nvencPresets = map[string]string{
	"ultrafast": "p1", "veryfast": "p2", "faster": "p3", "fast": "p4",
	"medium": "p5", "slow": "p6", "slower": "p7", "veryslow": "p7",
}

// Quick Sync has no ultrafast step.
var qsvPresets = map[string]string{
	"ultrafast": "veryfast", "veryfast": "veryfast", "faster": "faster",
	"fast": "fast", "medium": "medium", "slow": "slow",
	"slower": "slower", "veryslow": "veryslow",
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

// filterChain assembles the -vf graph. Returns "" when no video filtering is
// needed. engine is the chosen encoder library, which decides how the final
// frames have to be laid out.
func filterChain(s Spec, input, engine string) string {
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
	switch {
	case engine == "vaapi":
		// VAAPI encoders only accept frames that already live in GPU memory,
		// so the graph has to upload them in a format the driver likes.
		pix := "nv12"
		if strings.Contains(p.PixelFormat, "10") {
			pix = "p010"
		}
		chain = append(chain, "format="+pix, "hwupload")
	case p.PixelFormat != "":
		chain = append(chain, "format="+hwPixelFormat(engine, p.PixelFormat))
	}

	return strings.Join(chain, ",")
}

// hwPixelFormat spells a pixel format the way a hardware encoder expects it.
// ffmpeg's generic yuv420p names only work for the software encoders; the
// hardware ones want NV12 (or P010 for 10-bit).
func hwPixelFormat(engine, pf string) string {
	switch engine {
	case "nvenc", "qsv", "amf":
		if strings.Contains(pf, "10") {
			return "p010le"
		}
		if engine == "qsv" && strings.HasPrefix(pf, "yuv420p") {
			return "nv12"
		}
	}
	return pf
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

	enc, lib := resolveVideoEncoder(s.Video)
	if err := checkVideoEncoder(enc); err != nil {
		return nil, err
	}
	if pass > 0 && !lib.SupportsTwoPass {
		return nil, fmt.Errorf("%s cannot do two-pass encoding — switch two passes off or pick another library", orDefault(lib.Name, "this encoder"))
	}
	if lib.engine == "vaapi" {
		args = append(args, "-vaapi_device", vaapiDevice())
	}

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
	if vf := filterChain(s, input, lib.engine); vf != "" && enc != "copy" {
		args = append(args, "-vf", vf)
	}
	args = append(args, "-c:v", enc)

	if enc != "copy" {
		args = append(args, speedArgs(s.Video, lib, enc)...)
		if lib.SupportsTune && s.Video.Tune != "" && s.Video.Tune != "none" {
			args = append(args, "-tune", s.Video.Tune)
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
			args = append(args, qualityArgs(s.Video, lib, enc)...)
		}

		if s.Video.Profile != "" && s.Video.Profile != "auto" {
			args = append(args, "-profile:v", s.Video.Profile)
		}
		if s.Video.Level != "" && s.Video.Level != "auto" && lib.SupportsLevel {
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

// speedArgs maps the shared speed words onto whichever preset scale the chosen
// library actually understands.
func speedArgs(v VideoSpec, lib encoderLib, enc string) []string {
	if !lib.SupportsSpeed {
		return nil
	}
	speed := orDefault(v.Speed, "medium")
	switch lib.engine {
	case "software":
		switch enc {
		case "libx264", "libx265":
			return []string{"-preset", speed}
		case "libsvtav1":
			return []string{"-preset", orDefault(av1Presets[speed], "7")}
		case "libvpx-vp9":
			return []string{"-cpu-used", orDefault(vp9CPUUsed[speed], "3"),
				"-row-mt", "1", "-deadline", "good"}
		}
	case "nvenc":
		return []string{"-preset", orDefault(nvencPresets[speed], "p5")}
	case "qsv":
		return []string{"-preset", orDefault(qsvPresets[speed], "medium")}
	case "amf":
		return []string{"-quality", amfQuality(speed)}
	}
	return nil
}

func amfQuality(speed string) string {
	switch speed {
	case "ultrafast", "veryfast", "faster", "fast":
		return "speed"
	case "medium":
		return "balanced"
	}
	return "quality"
}

// qualityArgs renders constant-quality (or constant-quantiser) rate control.
// Every library spells it differently, and VideoToolbox even counts quality the
// other way round — the caller's number always means "lower is better".
func qualityArgs(v VideoSpec, lib encoderLib, enc string) []string {
	if lib.Kind == "gpu" {
		q := int(math.Round(v.Quality))
		if lib.QualityInverted {
			q = int(math.Round(lib.QualityMax)) - q
		}
		if q < 0 {
			q = 0
		}
		s := strconv.Itoa(q)
		switch lib.engine {
		case "nvenc":
			// CQ alone: without an explicit bitrate NVENC would otherwise
			// fall back to its default 2 Mbit/s target.
			return []string{"-rc", "vbr", "-cq", s, "-b:v", "0"}
		case "qsv":
			return []string{"-global_quality", s}
		case "vaapi":
			return []string{"-rc_mode", "CQP", "-qp", s}
		case "videotoolbox":
			return []string{"-q:v", s}
		case "amf":
			return []string{"-rc", "cqp", "-qp_i", s, "-qp_p", s}
		}
	}

	q := trimFloat(math.Round(v.Quality*10) / 10)
	if enc == "libvpx-vp9" {
		return []string{"-crf", q, "-b:v", "0"}
	}
	return []string{"-crf", q}
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
