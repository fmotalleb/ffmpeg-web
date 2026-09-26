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
	args := varg.New("ffmpeg-web").
		About(`A single Go binary that serves a browser UI for transcoding video. Presets,
a settings panel per topic, batch encoding of whole folders, a queue that
survives a crash, output verification, and post-encode actions.
`).
		Version(git.String())
	args.String("address", "a", "127.0.0.1:8723", "address to listen on").Env("LISTEN")
	args.String("root", "r", ".", "directory the browser is allowed to read sources from").Env("BASE_DIR")
	args.String("out", "o", "./encodes", "directory finished files are written to").Env("OUTPUT_DIR")
	args.String("queue", "q", "", "queue file (default: <out>/queue.json)").Env("QUEUE_FILE")
	args.String("ffmpeg", "", "ffmpeg", "path to the ffmpeg binary").Env("FFMPEG_PATH")
	args.String("ffprobe", "", "ffprobe", "path to the ffprobe binary").Env("FFPROBE_PATH")
	args.Uint64("max-upload", "", 16<<30, "largest accepted upload in bytes").Env("MAX_UPLOAD_SIZE")
	args.Bool("allow-commands", "", false, "let the post-queue action run a shell command").Env("ALLOW_COMMAND")

	args.String("basic-auth", "u", "", "basic auth value `username:password`").Env("BASIC_AUTH")
	must := func(err error) {
		if err != nil {
			logger.Fatal("startup failed", zap.Error(err))
		}
	}

	r := args.Handle(os.Args)
	if r.ShouldExit {
		must(r.Err)
		fmt.Println(r.Output)
		os.Exit(0)
	}
	cfg := r.Config

	addr := cfg.String("address")
	root := cfg.String("root")
	out := cfg.String("out")
	queueFile := cfg.String("queue")
	ffmpegBin := cfg.String("ffmpeg")
	ffprobeBin := cfg.String("ffprobe")
	maxUpload := cfg.Uint64("max-upload")
	allowCmds := cfg.Bool("allow-commands")
	basicAuth := cfg.String("basic-auth")
	auth := []string{"", ""}
	if basicAuth != "" {
		auth = strings.SplitN(basicAuth, ":", 2)
		if len(auth) != 2 {
			must(errors.New("auth field must be `user:pass`, only user given"))
		}
	}
	mediaRoot, err := filepath.Abs(root)
	must(err)
	outDir, err := filepath.Abs(out)
	must(err)
	must(os.MkdirAll(outDir, 0o755))
	uploadDir := filepath.Join(outDir, ".uploads")
	workDir := filepath.Join(outDir, ".work")
	must(os.MkdirAll(uploadDir, 0o755))
	must(os.MkdirAll(workDir, 0o755))

	for _, bin := range []string{ffmpegBin, ffprobeBin} {
		if _, err := exec.LookPath(bin); err != nil {
			logger.Fatal("required binary not found on PATH — install ffmpeg, or pass -ffmpeg/-ffprobe",
				zap.String("binary", bin))
		}
	}

	probeEncoders(ffmpegBin)

	queuePath := queueFile
	if queuePath == "" {
		queuePath = filepath.Join(outDir, "queue.json")
	}
	store := NewStore(queuePath, logger.Named("store"))
	snap, err := store.Load()
	must(err)

	broker := NewBroker()
	hooks := &hookRunner{log: logger.Named("hooks"), allowCommands: allowCmds, outDir: outDir}
	manager := NewManager(ffmpegBin, ffprobeBin, workDir, broker, store, hooks, logger.Named("queue"))
	recovered := manager.Restore(snap)
	store.Start(manager.Snapshot)
	manager.Start()

	presetStore := newPresetStore(filepath.Join(outDir, "presets.json"), logger.Named("presets"))
	presetStore.load()

	srv := &server{
		mediaRoot: mediaRoot,
		outDir:    outDir,
		uploadDir: uploadDir,
		workDir:   workDir,
		ffmpeg:    ffmpegBin,
		ffprobe:   ffprobeBin,
		broker:    broker,
		jobs:      manager,
		store:     store,
		presets:   presetStore,
		frames:    newFrameCache(256 << 20),
		log:       logger.Named("web"),
		monitor:   newSystemMonitor(),
		maxUpload: int64(maxUpload),
		allowCmds: allowCmds,

		authUsername: auth[0],
		authPassword: auth[1],
	}

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext: func(_ net.Listener) context.Context {
			return log.WithLogger(ctx, srv.log)
		},
	}

	go func() {
		logger.Info("ffmpeg-web", zap.String("version", git.String()))
		logger.Info("sources", zap.String("path", mediaRoot))
		logger.Info("encodes", zap.String("path", outDir))
		logger.Info("queue", zap.String("file", queuePath), zap.Int("jobs", len(snap.Jobs)))
		if recovered > 0 {
			logger.Info("recovered interrupted jobs — their partial output was deleted and they will run again",
				zap.Int("count", recovered))
		}
		logger.Info("listening", zap.String("addr", addr))
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("http server failed", zap.Error(err))
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down, saving the queue")
	// A frozen encode would outlive this server as a stopped process nothing
	// can wake any more, so let it run on like any other interrupted job.
	manager.thawFrozen()
	store.Flush()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
