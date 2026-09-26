package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

// Preset is a named starting point. The UI merges it into the current settings;
// the user can then change anything before queueing. Owned presets were saved
// by the user and can be replaced or deleted; built-ins in the code never are.
type Preset struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Group    string `json:"group"`
	Note     string `json:"note"`
	Owned    bool   `json:"owned"`
	Settings Spec   `json:"settings"`
}

func base(container string) Spec {
	return Spec{
		Container:   container,
		WebOptimize: container == "mp4",
		Video: VideoSpec{
			Encoder: "x264", RateMode: "quality", Quality: 22, Speed: "medium",
			Profile: "auto", Level: "auto", Tune: "none", FPSMode: "same",
		},
		Audio: AudioSpec{
			Encoder: "aac", Bitrate: 160, Mixdown: "stereo", SampleRate: 48000,
		},
		Picture: PictureSpec{ScaleMode: "source", KeepAspect: true},
		Filters: FilterSpec{Deinterlace: "off", Denoise: "off"},
		// Keeping the subtitles is the default: nothing is dropped unless the
		// user asks for it, so every preset starts from "copy".
		Subtitle: SubtitleSpec{Mode: "copy"},
	}
}

func withVideo(s Spec, fn func(*VideoSpec)) Spec { fn(&s.Video); return s }

var presets = buildPresets()

func buildPresets() []Preset {
	general1080 := base("mp4")
	general1080.Picture = PictureSpec{ScaleMode: "custom", Width: 1920, Height: 1080, KeepAspect: true}
	general1080.Video.Quality = 22
	general1080.Video.FPSMode = "peak"
	general1080.Video.FPS = "30"

	general720 := general1080
	general720.Picture = PictureSpec{ScaleMode: "custom", Width: 1280, Height: 720, KeepAspect: true}
	general720.Video.Quality = 23
	general720.Audio.Bitrate = 128

	fast480 := base("mp4")
	fast480.Picture = PictureSpec{ScaleMode: "custom", Width: 854, Height: 480, KeepAspect: true}
	fast480.Video.Quality = 25
	fast480.Video.Speed = "veryfast"
	fast480.Audio.Bitrate = 96

	hevc1080 := base("mkv")
	hevc1080.Video = VideoSpec{
		Encoder: "x265", RateMode: "quality", Quality: 26, Speed: "medium",
		Profile: "auto", Level: "auto", Tune: "none", FPSMode: "same",
	}
	hevc1080.Picture = PictureSpec{ScaleMode: "custom", Width: 1920, Height: 1080,
		KeepAspect: true, PixelFormat: "yuv420p10le"}

	hevc4k := hevc1080
	hevc4k.Picture = PictureSpec{ScaleMode: "custom", Width: 3840, Height: 2160,
		KeepAspect: true, PixelFormat: "yuv420p10le"}
	hevc4k.Video.Quality = 24
	hevc4k.Video.Speed = "slow"
	hevc4k.Audio.Bitrate = 192
	hevc4k.Audio.Mixdown = "5.1"

	av1web := base("webm")
	av1web.WebOptimize = false
	av1web.Video = VideoSpec{
		Encoder: "av1", RateMode: "quality", Quality: 32, Speed: "fast",
		Profile: "auto", Level: "auto", Tune: "none", FPSMode: "same",
	}
	av1web.Audio.Encoder = "opus"
	av1web.Audio.Bitrate = 128
	av1web.Picture = PictureSpec{ScaleMode: "custom", Width: 1920, Height: 1080, KeepAspect: true}

	vp9web := base("webm")
	vp9web.WebOptimize = false
	vp9web.Video = VideoSpec{
		Encoder: "vp9", RateMode: "quality", Quality: 31, Speed: "medium",
		Profile: "auto", Level: "auto", Tune: "none", FPSMode: "same",
	}
	vp9web.Audio.Encoder = "opus"
	vp9web.Audio.Bitrate = 128
	vp9web.Picture = PictureSpec{ScaleMode: "custom", Width: 1280, Height: 720, KeepAspect: true}

	phone := base("mp4")
	phone.Picture = PictureSpec{ScaleMode: "custom", Width: 1280, Height: 720, KeepAspect: true}
	phone.Video.Quality = 24
	phone.Video.Profile = "main"
	phone.Video.Level = "4.0"
	phone.Video.Speed = "fast"
	phone.Audio.Bitrate = 128

	social := base("mp4")
	social.Picture = PictureSpec{ScaleMode: "custom", Width: 1080, Height: 1920,
		KeepAspect: true, Pad: true}
	social.Video.Quality = 21
	social.Video.FPSMode = "constant"
	social.Video.FPS = "30"
	social.Audio.Bitrate = 128

	archive := base("mkv")
	archive.Video = withVideo(archive, func(v *VideoSpec) {
		v.Encoder = "x265"
		v.Quality = 20
		v.Speed = "slow"
	}).Video
	archive.Audio.Encoder = "flac"
	archive.Audio.Mixdown = "source"

	remux := base("mkv")
	remux.Video.Encoder = "copy"
	remux.Audio.Encoder = "copy"
	remux.Subtitle = SubtitleSpec{Mode: "copy"}

	return []Preset{
		{ID: "general-1080p30", Name: "1080p30", Group: "General",
			Note: "H.264, good balance of size and quality", Settings: general1080},
		{ID: "general-720p30", Name: "720p30", Group: "General",
			Note: "Smaller files, still sharp on a laptop", Settings: general720},
		{ID: "fast-480p", Name: "480p quick", Group: "General",
			Note: "Encodes fast, for previews and rough cuts", Settings: fast480},
		{ID: "hevc-1080p", Name: "H.265 1080p", Group: "Space saving",
			Note: "Roughly half the size of H.264 at similar quality", Settings: hevc1080},
		{ID: "hevc-2160p", Name: "H.265 4K", Group: "Space saving",
			Note: "10-bit, surround audio kept", Settings: hevc4k},
		{ID: "av1-1080p", Name: "AV1 1080p", Group: "Web",
			Note: "Smallest files, slowest encode", Settings: av1web},
		{ID: "vp9-720p", Name: "VP9 720p", Group: "Web",
			Note: "WebM that plays everywhere in a browser", Settings: vp9web},
		{ID: "device-phone", Name: "Phone and tablet", Group: "Devices",
			Note: "Conservative profile that old devices can decode", Settings: phone},
		{ID: "social-vertical", Name: "Vertical 1080x1920", Group: "Devices",
			Note: "Letterboxes wide video into a vertical frame", Settings: social},
		{ID: "archive-hevc", Name: "Archive", Group: "Lossless-ish",
			Note: "High quality H.265 with FLAC audio", Settings: archive},
		{ID: "remux", Name: "Remux only", Group: "Lossless-ish",
			Note: "Changes the container, re-encodes nothing", Settings: remux},
	}
}

func builtinPresetByName(name string) (Preset, bool) {
	for _, p := range presets {
		if strings.EqualFold(p.Name, name) {
			return p, true
		}
	}
	return Preset{}, false
}

// presetStore keeps the presets the user saves. Built-ins stay in code; user
// presets live in one JSON file next to the queue and are keyed by name —
// saving a preset with a name that already exists replaces it in place.
type presetStore struct {
	path string
	log  *zap.Logger
	mu   sync.Mutex
	user []Preset
}

func newPresetStore(path string, log *zap.Logger) *presetStore {
	return &presetStore{path: path, log: log}
}

// list returns the user's own presets first: they saved them for the files
// they are working on right now, so they belong above the built-ins.
func (s *presetStore) list() []Preset {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Preset, 0, len(presets)+len(s.user))
	out = append(out, s.user...)
	out = append(out, presets...)
	return out
}

// save creates a preset, or replaces the user preset with the same name. The
// name is the identity, so a repeat save never duplicates.
func (s *presetStore) save(name, group, note string, settings Spec) (Preset, error) {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return Preset{}, errors.New("give the preset a name")
	case len(name) > 60:
		return Preset{}, errors.New("preset name is too long (max 60 characters)")
	}
	if _, taken := builtinPresetByName(name); taken {
		return Preset{}, fmt.Errorf("%q is a built-in preset; pick a different name", name)
	}
	if settings.Container == "" {
		return Preset{}, errors.New("the preset has no settings to save")
	}
	// A preset is a starting point, not a snapshot of one file. Drop whatever
	// points at a particular source or output so applying it always starts clean.
	settings.Input = ""
	settings.OutputName = ""
	settings.Trim = TrimSpec{}
	settings.Audio = AudioSpec{
		Encoder: settings.Audio.Encoder, Bitrate: settings.Audio.Bitrate,
		Mixdown: settings.Audio.Mixdown, SampleRate: settings.Audio.SampleRate,
		Gain: settings.Audio.Gain, Normalize: settings.Audio.Normalize,
	}
	settings.Subtitle.Track = 0

	group = strings.TrimSpace(group)
	if group == "" {
		group = "My presets"
	}
	p := Preset{
		ID:       "user-" + fmt.Sprintf("%x", fnvHash(name)),
		Name:     name,
		Group:    group,
		Note:     strings.TrimSpace(note),
		Owned:    true,
		Settings: settings,
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.user {
		if strings.EqualFold(s.user[i].Name, name) {
			s.user[i] = p
			return p, s.write()
		}
	}
	s.user = append(s.user, p)
	if err := s.write(); err != nil {
		s.user = s.user[:len(s.user)-1]
		return Preset{}, err
	}
	return p, nil
}

func (s *presetStore) delete(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("empty preset name")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.user {
		if strings.EqualFold(s.user[i].Name, name) {
			s.user = append(s.user[:i], s.user[i+1:]...)
			return s.write()
		}
	}
	return fmt.Errorf("no preset named %q", name)
}

func (s *presetStore) load() {
	body, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.log.Error("could not read presets", zap.String("path", s.path), zap.Error(err))
		return
	}
	if err := json.Unmarshal(body, &s.user); err != nil {
		backup := fmt.Sprintf("%s.broken-%d", s.path, time.Now().Unix())
		_ = os.Rename(s.path, backup)
		s.log.Warn("presets file was unreadable, moved it aside",
			zap.String("backup", backup), zap.Error(err))
		s.user = nil
	}
}

func (s *presetStore) write() error {
	body, err := json.MarshalIndent(s.user, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func fnvHash(name string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(strings.ToLower(name)))
	return h.Sum64()
}
