package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/fmotalleb/go-tools/git"
	"github.com/fmotalleb/go-tools/log"
	"github.com/fmotalleb/varg"
	"go.uber.org/zap"

	"github.com/fmotalleb/ffmpeg-web/ffmpeg"
	"github.com/fmotalleb/ffmpeg-web/jobs"
	"github.com/fmotalleb/ffmpeg-web/server"
	"github.com/fmotalleb/ffmpeg-web/storage"
	"github.com/fmotalleb/ffmpeg-web/system"
)

func main() {
	logger := log.
		NewBuilder().
		FromEnv().
		InitialFields(map[string]any{
			"version": git.GetVersion(),
		}).
		MustBuild()

	ctx := log.WithLogger(
		context.Background(),
		logger,
	)

	// Parse command-line arguments using struct-based configuration
	cfg, err := parseConfig()
	if err != nil {
		logger.Fatal("failed to parse configuration", zap.Error(err))
	}

	// Process and validate configuration
	processed, err := processConfig(cfg)
	if err != nil {
		logger.Fatal("configuration error", zap.Error(err))
	}

	// Probe ffmpeg for available encoders
	ffmpeg.ProbeEncoders(processed.FFmpeg)

	// Load or create job storage
	store := storage.NewStore(processed.QueueFile, logger.Named("store"))
	snap, err := store.Load()
	if err != nil {
		logger.Fatal("failed to load queue", zap.Error(err))
	}

	// Initialize job management
	broker := jobs.NewBroker()
	hooks := jobs.NewHookRunner(logger.Named("hooks"), processed.AllowCmds, processed.OutDir)
	manager := jobs.NewManager(
		processed.FFmpeg, processed.FFProbe, processed.WorkDir,
		broker, store, hooks, logger.Named("queue"),
	)
	recovered := manager.Restore(snap)
	store.Start(manager.Snapshot)
	manager.Start()

	// Load presets
	presetStore := storage.NewPresetStore(
		filepath.Join(processed.OutDir, "presets.json"),
		logger.Named("presets"),
	)
	presetStore.Load()

	// Configure and create HTTP server
	srv := server.New(server.Config{
		MediaRoot: processed.MediaRoot,
		OutDir:    processed.OutDir,
		UploadDir: processed.UploadDir,
		WorkDir:   processed.WorkDir,
		FFmpeg:    processed.FFmpeg,
		FFprobe:   processed.FFProbe,
		Jobs:      manager,
		Broker:    broker,
		Store:     store,
		Presets:   presetStore,
		Frames:    ffmpeg.NewFrameCache(256 << 20),
		Monitor:   system.NewMonitor(),
		Assets:    webAssets,
		Log:       logger.Named("web"),
		MaxUpload: int64(processed.MaxUpload),
		AllowCmds: processed.AllowCmds,
		AuthUser:  processed.AuthUser,
		AuthPass:  processed.AuthPass,
	})

	// Create HTTP server
	httpSrv := &http.Server{
		Addr:              processed.Address,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext: func(_ net.Listener) context.Context {
			return log.WithLogger(ctx, logger.Named("web"))
		},
	}

	// Start server in background
	go func() {
		logger.Info("ffmpeg-web", zap.String("version", git.String()))
		logger.Info("sources", zap.String("path", processed.MediaRoot))
		logger.Info("encodes", zap.String("path", processed.OutDir))
		logger.Info("queue", zap.String("file", processed.QueueFile), zap.Int("jobs", len(snap.Jobs)))
		if recovered > 0 {
			logger.Info("recovered interrupted jobs",
				zap.String("info", "their partial output was deleted and they will run again"),
				zap.Int("count", recovered),
			)
		}
		logger.Info("listening", zap.String("addr", processed.Address))
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("http server failed", zap.Error(err))
		}
	}()

	// Wait for shutdown signal
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	// Graceful shutdown
	logger.Info("shutting down, saving the queue")
	manager.ThawFrozen()
	store.Flush()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}

// parseConfig parses command-line arguments and environment variables into a Config struct
func parseConfig() (*Config, error) {
	cfg := &Config{}
	fs := varg.New("ffmpeg-web").
		About(`A single Go binary that serves a browser UI for transcoding video. Presets,
a settings panel per topic, batch encoding of whole folders, a queue that
survives a crash, output verification, and post-encode actions.`).
		Version(git.String())

	// Register config struct fields as flags
	if err := fs.Struct(cfg); err != nil {
		return nil, fmt.Errorf("failed to register config: %w", err)
	}

	// Parse command-line arguments
	result := fs.Handle(os.Args[1:])
	if result.Err != nil {
		return nil, fmt.Errorf("failed to parse arguments: %w", result.Err)
	}

	// Handle help/version requests
	if result.ShouldExit {
		fmt.Println(result.Output)
		os.Exit(0)
	}

	// Unmarshal parsed arguments into config struct
	if err := result.Config.Unmarshal(cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return cfg, nil
}

// processConfig validates and processes the raw configuration
func processConfig(cfg *Config) (*ProcessedConfig, error) {
	// Convert paths to absolute paths
	mediaRoot, err := filepath.Abs(cfg.Root)
	if err != nil {
		return nil, fmt.Errorf("invalid root path %q: %w", cfg.Root, err)
	}

	outDir, err := filepath.Abs(cfg.Out)
	if err != nil {
		return nil, fmt.Errorf("invalid output directory %q: %w", cfg.Out, err)
	}

	// Determine queue file path
	queueFile := cfg.Queue
	if queueFile == "" {
		queueFile = filepath.Join(outDir, "queue.json")
	}

	// Create necessary directories
	uploadDir := filepath.Join(outDir, ".uploads")
	workDir := filepath.Join(outDir, ".work")

	for dir, name := range map[string]string{
		outDir:    "output",
		uploadDir: "upload",
		workDir:   "work",
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("failed to create %s directory %q: %w", name, dir, err)
		}
	}

	// Verify binary paths
	for _, bin := range []string{cfg.FFmpeg, cfg.FFProbe} {
		if _, err := exec.LookPath(bin); err != nil {
			return nil, fmt.Errorf(
				"required binary %q not found on PATH — install ffmpeg, or pass --ffmpeg/--ffprobe: %w",
				bin, err,
			)
		}
	}

	// Parse and validate basic auth credentials
	authUser, authPass := "", ""
	if cfg.BasicAuth != "" {
		parts := strings.SplitN(cfg.BasicAuth, ":", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			return nil, errors.New("--basic-auth must be in format 'username:password' with both non-empty")
		}
		authUser = parts[0]
		authPass = parts[1]
	}

	return &ProcessedConfig{
		Address:   cfg.Address,
		MediaRoot: mediaRoot,
		OutDir:    outDir,
		UploadDir: uploadDir,
		WorkDir:   workDir,
		QueueFile: queueFile,
		FFmpeg:    cfg.FFmpeg,
		FFProbe:   cfg.FFProbe,
		MaxUpload: cfg.MaxUpload,
		AllowCmds: cfg.AllowCommands,
		AuthUser:  authUser,
		AuthPass:  authPass,
	}, nil
}
