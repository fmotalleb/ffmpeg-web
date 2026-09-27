package main

// Config represents command-line and environment configuration for ffmpeg-web
type Config struct {
	// Server configuration
	Address string `arg:"address" arg_short:"a" env:"LISTEN" default:"127.0.0.1:8723" help:"address to listen on"`

	// File system paths
	Root string `arg:"root" arg_short:"r" env:"BASE_DIR" default:"." help:"directory the browser is allowed to read sources from"`
	Out  string `arg:"out" arg_short:"o" env:"OUTPUT_DIR" default:"./encodes" help:"directory finished files are written to"`

	// Queue and binary paths
	Queue   string `arg:"queue" arg_short:"q" env:"QUEUE_FILE" default:"" help:"queue file (default: <out>/queue.json)"`
	FFmpeg  string `arg:"ffmpeg" env:"FFMPEG_PATH" default:"ffmpeg" help:"path to the ffmpeg binary"`
	FFProbe string `arg:"ffprobe" env:"FFPROBE_PATH" default:"ffprobe" help:"path to the ffprobe binary"`

	// Upload and security settings
	MaxUpload     uint64 `arg:"max-upload" env:"MAX_UPLOAD_SIZE" default:"17179869184" help:"largest accepted upload in bytes (default: 16GB)"`
	AllowCommands bool   `arg:"allow-commands" env:"ALLOW_COMMAND" default:"false" help:"let the post-queue action run a shell command"`
	BasicAuth     string `arg:"basic-auth" arg_short:"u" env:"BASIC_AUTH" default:"" help:"basic auth credentials in format username:password"`
}

// ProcessedConfig contains validated and processed configuration
type ProcessedConfig struct {
	Address   string
	MediaRoot string
	OutDir    string
	UploadDir string
	WorkDir   string
	QueueFile string
	FFmpeg    string
	FFProbe   string
	MaxUpload uint64
	AllowCmds bool
	AuthUser  string
	AuthPass  string
}
