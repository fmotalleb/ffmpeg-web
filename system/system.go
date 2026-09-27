// Package system describes the machine and what ffmpeg is doing to it: the
// hardware report behind the "Hardware" chip in the top bar.
package system

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
)

// The hardware report behind the "Hardware" chip in the top bar. It answers the
// two questions worth asking before queueing anything: how busy is this machine
// right now, and will an encode land on the CPU or on a graphics chip?
//
// Everything here is best effort. Reading /proc is Linux-only, so a plate is
// simply left out (zero, or -1 for the load averages) on systems that cannot
// answer — the UI hides what it did not get rather than inventing a number.

type HwDevice struct {
	Kind   string `json:"kind"` // nvidia | intel | amd | apple | gpu
	Name   string `json:"name"`
	Path   string `json:"path,omitempty"`
	Driver string `json:"driver,omitempty"`
}

// HwEncoderStatus is one hardware family (NVENC, Quick Sync, …) reduced to what
// this machine can actually do with it.
type HwEncoderStatus struct {
	Engine    string   `json:"engine"`
	Label     string   `json:"label"`
	Vendor    string   `json:"vendor"`
	Available bool     `json:"available"`
	Reason    string   `json:"reason,omitempty"`  // why nothing here works, when nothing does
	Codecs    []string `json:"codecs"`            // codecs that do work
	Missing   []string `json:"missing,omitempty"` // ffmpeg encoders this build lacks
}

// EncodeLoad is what the queue is asking of the machine while the report is
// taken.
type EncodeLoad struct {
	Jobs int     `json:"jobs"`
	FPS  float64 `json:"fps"`
}

// FFmpegProcess is one live ffmpeg/ffprobe process, measured the way top does
// it: two samples of its /proc counters, a moment apart.
type FFmpegProcess struct {
	PID     int     `json:"pid"`
	Kind    string  `json:"kind"`            // ffmpeg | ffprobe
	JobID   string  `json:"jobId,omitempty"` // the queued job that owns it, when known
	Sampled bool    `json:"sampled"`         // false until a second sample exists
	CPU     float64 `json:"cpu"`             // percent of a single core
	RSS     uint64  `json:"rss"`             // bytes of resident memory
	Threads int     `json:"threads"`
}

// FFmpegUsage is how much of the machine ffmpeg is holding right now.
type FFmpegUsage struct {
	Running   bool            `json:"running"`
	Sampled   bool            `json:"sampled"`   // false until a second sample exists
	CPU       float64         `json:"cpu"`       // percent of a single core, all processes
	CPUofHost float64         `json:"cpuOfHost"` // percent of the whole machine
	RSS       uint64          `json:"rss"`       // bytes of resident memory
	Processes []FFmpegProcess `json:"processes"`
}

// Status is the whole report, ready to be sent to the browser.
type Status struct {
	Hostname      string            `json:"hostname"`
	OS            string            `json:"os"`
	Arch          string            `json:"arch"`
	CPUs          int               `json:"cpus"`
	CPUModel      string            `json:"cpuModel,omitempty"`
	Load1         float64           `json:"load1"`
	Load5         float64           `json:"load5"`
	Load15        float64           `json:"load15"`
	MemTotal      uint64            `json:"memTotal"`
	MemUsed       uint64            `json:"memUsed"`
	MemPercent    float64           `json:"memPercent"`
	Devices       []HwDevice        `json:"devices"`
	Encoders      []HwEncoderStatus `json:"encoders"`
	Encoding      EncodeLoad        `json:"encoding"`
	FFmpeg        FFmpegUsage       `json:"ffmpegUsage"`
	FFmpegVersion string            `json:"ffmpegVersion,omitempty"`
}

// hwEngineLabels name the hardware families the catalog can offer.
var hwEngineLabels = map[string]string{
	"nvenc":        "NVIDIA NVENC",
	"qsv":          "Intel Quick Sync",
	"vaapi":        "VAAPI (Linux GPU)",
	"videotoolbox": "Apple VideoToolbox",
	"amf":          "AMD AMF",
}

var codecLabels = map[string]string{
	"h264": "H.264",
	"hevc": "H.265/HEVC",
	"av1":  "AV1",
	"vp9":  "VP9",
}

// Collect assembles the whole report: the machine's fixed facts, the encoders
// it can offer, and what ffmpeg is doing right now.
func Collect(ffmpegBin string, monitor *Monitor, jobPIDs map[string]int, encoding EncodeLoad) Status {
	status := Status{
		Hostname:      hostname(),
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		CPUs:          runtime.NumCPU(),
		CPUModel:      cpuModel(),
		Load1:         -1,
		Load5:         -1,
		Load15:        -1,
		Devices:       gpuDevices(),
		Encoders:      hardwareEncoders(),
		Encoding:      encoding,
		FFmpeg:        monitor.usage(jobPIDs),
		FFmpegVersion: ffmpegVersion(ffmpegBin),
	}
	status.Load1, status.Load5, status.Load15 = loadAverage()
	status.MemTotal, status.MemUsed = memoryUsage()
	if status.MemTotal > 0 {
		status.MemPercent = float64(status.MemUsed) / float64(status.MemTotal) * 100
	}
	return status
}

// hardwareEncoders groups the catalog's GPU libraries by family and works out
// which of their codecs this machine can use, and which encoders the local
// ffmpeg build simply does not have.
func hardwareEncoders() []HwEncoderStatus {
	index := map[string]int{}
	out := []HwEncoderStatus{}
	for _, l := range ffmpeg.Libs {
		if l.Kind != "gpu" {
			continue
		}
		i, ok := index[l.Engine]
		if !ok {
			i = len(out)
			index[l.Engine] = i
			out = append(out, HwEncoderStatus{
				Engine: l.Engine,
				Label:  hwEngineLabels[l.Engine],
				Vendor: l.Vendor,
				Codecs: []string{},
			})
		}
		group := &out[i]
		reason := ffmpeg.UnavailableReason(l)
		if reason == "" {
			group.Available = true
			group.Codecs = append(group.Codecs, codecLabels[l.Codec])
			continue
		}
		if group.Reason == "" {
			group.Reason = reason
		}
		// "missing" is about the ffmpeg build only: a machine with no NVIDIA
		// card still has the encoders, it just cannot use them.
		if ffmpeg.MissingFromFFmpeg(l) {
			group.Missing = append(group.Missing, l.FFmpeg)
		}
	}
	return out
}

func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		return ""
	}
	return name
}

// ---- processors and memory (Linux /proc, plus the macOS load average) ----

func loadAverage() (float64, float64, float64) {
	switch runtime.GOOS {
	case "linux":
		data, err := os.ReadFile("/proc/loadavg")
		if err != nil {
			break
		}
		return parseTriple(strings.Fields(string(data)))
	case "darwin":
		// sysctl prints "{ 1.20 1.35 1.44 }".
		return parseTriple(strings.Fields(strings.Trim(sysctl("vm.loadavg"), "{}")))
	}
	return -1, -1, -1
}

func parseTriple(fields []string) (float64, float64, float64) {
	if len(fields) < 3 {
		return -1, -1, -1
	}
	one, err1 := strconv.ParseFloat(fields[0], 64)
	five, err2 := strconv.ParseFloat(fields[1], 64)
	fifteen, err3 := strconv.ParseFloat(fields[2], 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return -1, -1, -1
	}
	return one, five, fifteen
}

// memoryUsage reads MemTotal and MemAvailable from /proc/meminfo. Systems
// without that file report zero and the UI leaves the row out.
func memoryUsage() (total, used uint64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()

	var available uint64
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		key, value, ok := strings.Cut(scanner.Text(), ":")
		if !ok {
			continue
		}
		switch key {
		case "MemTotal":
			total = meminfoBytes(value)
		case "MemAvailable":
			available = meminfoBytes(value)
		}
	}
	if available > total {
		available = total
	}
	return total, total - available
}

func meminfoBytes(value string) uint64 {
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return 0
	}
	kb, _ := strconv.ParseUint(fields[0], 10, 64)
	return kb * 1024
}

// cpuModel names the processor, which is the one thing that tells a user
// whether software encodes are going to hurt.
func cpuModel() string {
	if runtime.GOOS == "darwin" {
		return sysctl("machdep.cpu.brand_string")
	}
	data, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		// "model name" is x86, "Hardware" is often 32-bit ARM, "Processor" is
		// the fallback on both. The lowercase "processor"/"model" lines that
		// newer kernels add are deliberately not matched.
		switch strings.TrimSpace(key) {
		case "model name", "Hardware", "Model", "Processor":
			if model := strings.TrimSpace(value); model != "" {
				return model
			}
		}
	}
	return ""
}

func sysctl(key string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "sysctl", "-n", key).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// ---- graphics devices ----

func gpuDevices() []HwDevice {
	switch runtime.GOOS {
	case "linux":
		return linuxGPUDevices()
	case "darwin":
		return []HwDevice{{Kind: "apple", Name: "Apple VideoToolbox (built in)"}}
	}
	return []HwDevice{}
}

func linuxGPUDevices() []HwDevice {
	devices := []HwDevice{}
	if fileExists("/dev/nvidiactl") || fileExists("/dev/nvidia0") {
		devices = append(devices, HwDevice{
			Kind: "nvidia", Name: "NVIDIA GPU", Path: "/dev/nvidia0", Driver: nvidiaDriver(),
		})
	}
	nodes, _ := filepath.Glob("/dev/dri/renderD*")
	for _, node := range nodes {
		devices = append(devices, drmDevice(node))
	}
	return devices
}

// drmDevice describes one render node. The name comes from sysfs — the PCI
// vendor plus the kernel driver — because "/dev/dri/renderD128" says nothing
// about which card it is.
func drmDevice(node string) HwDevice {
	base := filepath.Base(node)
	class := "/sys/class/drm/" + base
	vendor := strings.TrimSpace(readFileString(filepath.Join(class, "device", "vendor")))
	driver := ""
	for _, line := range strings.Split(readFileString(filepath.Join(class, "device", "uevent")), "\n") {
		if after, ok := strings.CutPrefix(line, "DRIVER="); ok {
			driver = after
			break
		}
	}

	kind, label := "gpu", "Graphics device"
	switch vendor {
	case "0x10de":
		kind, label = "nvidia", "NVIDIA GPU"
	case "0x8086":
		kind, label = "intel", "Intel graphics"
	case "0x1002", "0x1022":
		kind, label = "amd", "AMD GPU"
	}
	if driver != "" {
		label += " (" + driver + ")"
	}
	return HwDevice{Kind: kind, Name: label, Path: node, Driver: driver}
}

func nvidiaDriver() string {
	for _, field := range strings.Fields(readFileString("/proc/driver/nvidia/version")) {
		if field[0] >= '0' && field[0] <= '9' && strings.Contains(field, ".") {
			return field
		}
	}
	return ""
}

func readFileString(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// ---- what ffmpeg is using right now ----

// ticksPerSecond is the unit of the utime/stime fields in /proc/<pid>/stat.
// The kernel reports them in 1/100s regardless of how it was built, so this is
// safe to hard-code (it is not the same thing as HZ).
const ticksPerSecond = 100

// systemMonitor remembers the previous sample of the ffmpeg processes so the
// next one can turn their CPU counters into a rate.
type Monitor struct {
	mu   sync.Mutex
	at   time.Time
	prev map[int]ffmpegSample
}

// NewMonitor creates the sampler that turns the previous reading into a rate.
func NewMonitor() *Monitor {
	return &Monitor{prev: map[int]ffmpegSample{}}
}

type ffmpegSample struct {
	kind    string
	ticks   uint64
	rss     uint64
	threads int
}

// usage reports what ffmpeg is doing, and which queued job each of those
// processes belongs to. The job PIDs come from the queue rather than from
// matching process names, so a job row always describes its own encode.
func (m *Monitor) usage(jobPIDs map[string]int) FFmpegUsage {
	samples := readFFmpegProcesses(jobPIDs)
	now := time.Now()

	m.mu.Lock()
	previous, since := m.prev, m.at
	m.prev, m.at = samples, now
	m.mu.Unlock()

	owner := map[int]string{}
	for id, pid := range jobPIDs {
		owner[pid] = id
	}

	elapsed := now.Sub(since).Seconds()
	usage := FFmpegUsage{Processes: []FFmpegProcess{}}
	pids := make([]int, 0, len(samples))
	for pid := range samples {
		pids = append(pids, pid)
	}
	sort.Ints(pids)

	for _, pid := range pids {
		sample := samples[pid]
		proc := FFmpegProcess{
			PID: pid, Kind: sample.kind, JobID: owner[pid],
			RSS: sample.rss, Threads: sample.threads,
		}
		if before, ok := previous[pid]; ok && elapsed > 0 && sample.ticks >= before.ticks {
			usage.Sampled, proc.Sampled = true, true
			proc.CPU = float64(sample.ticks-before.ticks) / ticksPerSecond / elapsed * 100
		}
		usage.CPU += proc.CPU
		usage.RSS += proc.RSS
		usage.Processes = append(usage.Processes, proc)
	}
	usage.Running = len(usage.Processes) > 0
	if cpus := runtime.NumCPU(); cpus > 0 {
		usage.CPUofHost = usage.CPU / float64(cpus)
	}
	return usage
}

// readFFmpegProcesses finds the running ffmpeg and ffprobe processes and reads
// their CPU counters. Without /proc (any non-Linux host) it reports none.
//
// Processes the queue is running are read by PID whether or not their name
// looks like ffmpeg, so a job is never left unreported because its binary is
// called something else.
func readFFmpegProcesses(jobPIDs map[string]int) map[int]ffmpegSample {
	out := map[int]ffmpegSample{}
	if entries, err := os.ReadDir("/proc"); err == nil {
		for _, entry := range entries {
			pid, err := strconv.Atoi(entry.Name())
			if err != nil || !entry.IsDir() {
				continue
			}
			name := strings.TrimSpace(readFileString("/proc/" + entry.Name() + "/comm"))
			kind := ""
			switch {
			case strings.HasPrefix(name, "ffmpeg"):
				kind = "ffmpeg"
			case strings.HasPrefix(name, "ffprobe"):
				kind = "ffprobe"
			default:
				continue
			}
			sample, ok := readProcStat("/proc/" + entry.Name() + "/stat")
			if !ok {
				continue
			}
			sample.kind = kind
			out[pid] = sample
		}
	}
	for _, pid := range jobPIDs {
		if _, ok := out[pid]; ok {
			continue
		}
		if sample, ok := readProcStat("/proc/" + strconv.Itoa(pid) + "/stat"); ok {
			sample.kind = "ffmpeg"
			out[pid] = sample
		}
	}
	return out
}

// readProcStat pulls the counters we care about out of /proc/<pid>/stat. The
// second field is the program name in parentheses and may contain spaces, so
// the fields are counted from the last ")".
func readProcStat(path string) (ffmpegSample, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ffmpegSample{}, false
	}
	end := strings.LastIndexByte(string(data), ')')
	if end < 0 {
		return ffmpegSample{}, false
	}
	fields := strings.Fields(string(data)[end+1:])
	if len(fields) < 22 {
		return ffmpegSample{}, false
	}
	utime, errU := strconv.ParseUint(fields[11], 10, 64)
	stime, errS := strconv.ParseUint(fields[12], 10, 64)
	threads, errT := strconv.Atoi(fields[17])
	rss, errR := strconv.ParseUint(fields[21], 10, 64)
	if errU != nil || errS != nil || errT != nil || errR != nil {
		return ffmpegSample{}, false
	}
	return ffmpegSample{
		ticks:   utime + stime,
		threads: threads,
		rss:     rss * uint64(os.Getpagesize()),
	}, true
}

// ---- ffmpeg ----

var (
	ffmpegVersionOnce sync.Once
	ffmpegVersionName string
)

// ffmpegVersion asks the binary once per process: the answer cannot change
// while it runs, and the popover polls.
func ffmpegVersion(bin string) string {
	ffmpegVersionOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, bin, "-version").Output()
		if err != nil {
			return
		}
		// "ffmpeg version 6.1.1-static Copyright (c) ..."
		fields := strings.Fields(strings.SplitN(string(out), "\n", 2)[0])
		if len(fields) >= 3 && fields[0] == "ffmpeg" && fields[1] == "version" {
			ffmpegVersionName = fields[2]
		}
	})
	return ffmpegVersionName
}
