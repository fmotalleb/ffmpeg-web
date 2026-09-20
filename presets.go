package main

// Preset is a named starting point. The UI merges it into the current settings;
// the user can then change anything before queueing.
type Preset struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Group    string `json:"group"`
	Note     string `json:"note"`
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
		Picture:  PictureSpec{ScaleMode: "source", KeepAspect: true},
		Filters:  FilterSpec{Deinterlace: "off", Denoise: "off"},
		Subtitle: SubtitleSpec{Mode: "none"},
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
