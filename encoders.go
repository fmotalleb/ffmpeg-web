package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Every codec can be produced by more than one encoder library. The software
// libraries run on the CPU and give the smallest files; the hardware ones hand
// the work to a graphics chip (or a dedicated encoder block) and finish in a
// fraction of the time at a slightly worse size for the same quality.
//
// The UI shows this list under the encoder picker and stores the chosen entry
// in Spec.Video.Library.

// encoderLib is one selectable implementation of a codec.
type encoderLib struct {
	ID     string `json:"id"`     // sw | nvenc | qsv | vaapi | videotoolbox | amf
	Codec  string `json:"codec"`  // h264 | hevc | av1 | vp9
	Name   string `json:"name"`   // shown in the picker
	FFmpeg string `json:"ffmpeg"` // ffmpeg encoder name
	Kind   string `json:"kind"`   // cpu | gpu
	Vendor string `json:"vendor,omitempty"`
	Note   string `json:"note"`

	QualityMax      float64 `json:"qualityMax"`
	QualityGood     float64 `json:"qualityGood"`
	QualityInverted bool    `json:"qualityInverted,omitempty"`

	SupportsSpeed   bool `json:"supportsSpeed"`
	SupportsTune    bool `json:"supportsTune"`
	SupportsLevel   bool `json:"supportsLevel"`
	SupportsTwoPass bool `json:"supportsTwoPass"`

	Available   bool   `json:"available"`
	Unavailable string `json:"unavailableReason,omitempty"`

	engine string // software | nvenc | qsv | vaapi | videotoolbox | amf
}

// encoderKind explains a whole group of libraries to the user.
type encoderKind struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Blurb string `json:"blurb"`
}

var encoderKinds = []encoderKind{
	{
		ID:    "cpu",
		Label: "CPU (software)",
		Blurb: "Encodes on the processor. Smallest files for a given quality and the most predictable results, but it is the slowest and keeps the machine busy while it runs.",
	},
	{
		ID:    "gpu",
		Label: "GPU (hardware)",
		Blurb: "Encodes on the graphics chip. Several times faster and barely touches the CPU, but you usually need a higher quality number for the same file size.",
	},
}

// codecForEncoder maps the UI's encoder choice onto the codec family each
// library belongs to.
var codecForEncoder = map[string]string{
	"x264": "h264",
	"x265": "hevc",
	"vp9":  "vp9",
	"av1":  "av1",
	"copy": "copy",
}

func lib(codec, id, name, ffmpeg, kind, vendor, engine, note string, qMax, qGood float64) encoderLib {
	l := encoderLib{
		ID: id, Codec: codec, Name: name, FFmpeg: ffmpeg,
		Kind: kind, Vendor: vendor, engine: engine, Note: note,
		QualityMax: qMax, QualityGood: qGood,
	}
	l.SupportsSpeed = engine != "vaapi" && engine != "videotoolbox"
	l.SupportsTune = ffmpeg == "libx264" || ffmpeg == "libx265"
	l.SupportsLevel = ffmpeg == "libx264" || ffmpeg == "libx265"
	l.SupportsTwoPass = engine == "software"
	return l
}

// qt flags a library whose quality scale runs the other way: for Apple's
// VideoToolbox a higher -q:v means better quality, not worse.
func qt(l encoderLib) encoderLib {
	l.QualityInverted = true
	return l
}

// encoderLibs is the whole catalog. Order matters: the software entry is the
// default one for its codec and comes first.
var encoderLibs = []encoderLib{
	// ---- H.264 ----
	lib("h264", "sw", "x264 (software)", "libx264", "cpu", "", "software",
		"Runs several threads on the CPU. The best quality per bit, slowest of the bunch, and the only option that supports three passes of tuning.",
		51, 23),
	lib("h264", "nvenc", "NVIDIA NVENC", "h264_nvenc", "gpu", "NVIDIA", "nvenc",
		"Runs on an NVIDIA GeForce/Quadro card and is usually the fastest option. Needs a driver and a card new enough to expose NVENC; two-pass is not available.",
		51, 26),
	lib("h264", "qsv", "Intel Quick Sync", "h264_qsv", "gpu", "Intel", "qsv",
		"Runs on the video block inside Intel integrated and Arc graphics. Fast and power friendly, quality sits a little behind x264.",
		51, 25),
	lib("h264", "vaapi", "VAAPI (Linux GPU)", "h264_vaapi", "gpu", "AMD / Intel", "vaapi",
		"The Linux hardware path for AMD and Intel GPUs. Works on most distributions but quality depends on the driver. No speed presets.",
		51, 26),
	qt(lib("h264", "videotoolbox", "Apple VideoToolbox", "h264_videotoolbox", "gpu", "Apple", "videotoolbox",
		"The encoder built into macOS on Apple silicon and Intel Macs. The quality slider changes meaning behind the scenes, so a low number still means better looking and bigger.",
		100, 30)),
	lib("h264", "amf", "AMD AMF", "h264_amf", "gpu", "AMD", "amf",
		"Windows-only hardware encoder for AMD Radeon cards. Good speeds, quality close to NVENC on recent drivers.",
		51, 26),

	// ---- H.265 ----
	lib("hevc", "sw", "x265 (software)", "libx265", "cpu", "", "software",
		"Runs several threads on the CPU. Roughly half the size of H.264 at the same quality, but slower and harder to play on old devices.",
		51, 26),
	lib("hevc", "nvenc", "NVIDIA NVENC", "hevc_nvenc", "gpu", "NVIDIA", "nvenc",
		"Runs on an NVIDIA card. Very fast, useful when H.265 quality matters less than getting the job done; two-pass is not available.",
		51, 28),
	lib("hevc", "qsv", "Intel Quick Sync", "hevc_qsv", "gpu", "Intel", "qsv",
		"Runs on Intel graphics. Handles 8-bit and 10-bit H.265 and stays cool while doing it.",
		51, 27),
	lib("hevc", "vaapi", "VAAPI (Linux GPU)", "hevc_vaapi", "gpu", "AMD / Intel", "vaapi",
		"Linux hardware H.265 for AMD and Intel GPUs. Needs /dev/dri and a ffmpeg built with VAAPI.",
		51, 28),
	qt(lib("hevc", "videotoolbox", "Apple VideoToolbox", "hevc_videotoolbox", "gpu", "Apple", "videotoolbox",
		"Hardware H.265 on macOS. Note that some Macs do not offer this profile at all — if the job fails, fall back to H.264.",
		100, 30)),
	lib("hevc", "amf", "AMD AMF", "hevc_amf", "gpu", "AMD", "amf",
		"Windows hardware H.265 for AMD Radeon cards.",
		51, 28),

	// ---- AV1 ----
	lib("av1", "sw", "SVT-AV1 (software)", "libsvtav1", "cpu", "", "software",
		"Runs on the CPU with many threads. AV1 gives the smallest files of all, so it is worth the wait for archival copies. Speed preset matters a lot here.",
		63, 32),
	lib("av1", "nvenc", "NVIDIA NVENC", "av1_nvenc", "gpu", "NVIDIA", "nvenc",
		"AV1 on RTX 40 series and newer. Fast, and one of the first hardware AV1 encoders; needs a recent driver.",
		51, 30),
	lib("av1", "qsv", "Intel Quick Sync", "av1_qsv", "gpu", "Intel", "qsv",
		"AV1 on Intel Arc and recent integrated graphics. Good balance of speed and size.",
		51, 28),

	// ---- VP9 ----
	lib("vp9", "sw", "libvpx (software)", "libvpx-vp9", "cpu", "", "software",
		"The reference VP9 encoder, used for WebM. Very slow at high quality settings but production proven.",
		63, 31),
	lib("vp9", "qsv", "Intel Quick Sync", "vp9_qsv", "gpu", "Intel", "qsv",
		"VP9 on Intel graphics. WebM containers only, and quality is behind libvpx.",
		63, 33),
}

func librariesForCodec(codec string) []encoderLib {
	out := make([]encoderLib, 0, 3)
	for _, l := range encoderLibs {
		if l.Codec == codec {
			out = append(out, l)
		}
	}
	return out
}

// resolveLibrary looks up the library a spec asked for. An empty or unknown id
// falls back to the software entry, which keeps queue files and presets written
// before libraries existed working unchanged.
func resolveLibrary(id, encoder string) (encoderLib, bool) {
	codec := codecForEncoder[encoder]
	if codec == "" || codec == "copy" {
		return encoderLib{}, false
	}
	for _, l := range librariesForCodec(codec) {
		if l.ID == id {
			return l, true
		}
	}
	for _, l := range librariesForCodec(codec) {
		if l.engine == "software" {
			return l, true
		}
	}
	return encoderLib{}, false
}

// ---- availability of the encoders in the local ffmpeg build ----

// ffmpegVideoEncoders holds every video encoder the configured ffmpeg binary
// knows about. It is filled once at startup by probeEncoders, before any
// request is served, and only read afterwards.
var ffmpegVideoEncoders map[string]bool

func probeEncoders(bin string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, "-hide_banner", "-encoders").Output()
	if err != nil {
		return
	}
	set := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		// Encoder rows look like " V....D libx264   libx264 H.264 ...".
		if len(fields) < 2 || !strings.HasPrefix(fields[0], "V") {
			continue
		}
		set[fields[1]] = true
	}
	ffmpegVideoEncoders = set
}

// hasRenderNode reports whether the machine exposes a GPU render node, which is
// what the VAAPI and Quick Sync encoders need on Linux.
func hasRenderNode() bool {
	matches, _ := filepath.Glob("/dev/dri/renderD*")
	return len(matches) > 0
}

// vaapiDevice is the render node the VAAPI encoders should use. filepath.Glob
// returns its matches sorted, so the first one is stable across runs.
func vaapiDevice() string {
	matches, _ := filepath.Glob("/dev/dri/renderD*")
	if len(matches) > 0 {
		return matches[0]
	}
	return "/dev/dri/renderD128"
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// unavailableReason explains why a library cannot be used here, or returns ""
// when it can. The text is shown next to the disabled entry in the UI.
func unavailableReason(l encoderLib) string {
	if ffmpegVideoEncoders != nil && !ffmpegVideoEncoders[l.FFmpeg] {
		return fmt.Sprintf("this ffmpeg build has no %s encoder", l.FFmpeg)
	}
	switch l.engine {
	case "nvenc":
		if runtime.GOOS == "linux" && !fileExists("/dev/nvidiactl") && !fileExists("/dev/nvidia0") {
			return "no NVIDIA device found"
		}
	case "qsv":
		if runtime.GOOS == "linux" && !hasRenderNode() {
			return "no Intel graphics device found"
		}
	case "vaapi":
		if !hasRenderNode() {
			return "no /dev/dri graphics device found"
		}
	case "videotoolbox":
		if runtime.GOOS != "darwin" {
			return "only available on macOS"
		}
	case "amf":
		if runtime.GOOS != "windows" {
			return "only available on Windows"
		}
	}
	return ""
}

// encoderCatalog is the catalog as sent to the browser, with availability
// filled in for this machine.
func encoderCatalog() []encoderLib {
	out := make([]encoderLib, 0, len(encoderLibs))
	for _, l := range encoderLibs {
		if reason := unavailableReason(l); reason != "" {
			l.Available = false
			l.Unavailable = reason
		} else {
			l.Available = true
		}
		out = append(out, l)
	}
	return out
}

func (s *server) handleEncoders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"kinds":     encoderKinds,
		"libraries": encoderCatalog(),
	})
}
