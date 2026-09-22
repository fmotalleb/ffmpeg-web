# Project Knowledge

## What This Is

**Transcoder** — a single-binary Go web app that provides a HandBrake-style browser UI over ffmpeg. No external dependencies (pure stdlib). Web assets are embedded via `go:embed`.

## Quickstart

```sh
# Build
go build -o transcoder .

# Run
./transcoder -root ~/Videos -out ~/Videos/encoded
# Then open http://127.0.0.1:8723

# Run directly (no build step)
go run . -root ~/Videos -out ~/Videos/encoded
```

## Requirements

- Go 1.27+ (uses `http.ServeMux` method patterns)
- `ffmpeg` and `ffprobe` on PATH (ffmpeg 6.0+)
- No external Go dependencies — stdlib only

## File Layout

| File | Purpose |
|------|---------|
| `main.go` | HTTP routes, path sandboxing, uploads, SSE endpoint, entry point |
| `jobs.go` | Job queue manager, ffmpeg supervision, progress parsing, event broker |
| `ffmpeg.go` | `Spec` types and ffmpeg argument builder (filters, rate control, two-pass) |
| `encoders.go` | Encoder library catalog (software and hardware) and what the local ffmpeg build supports |
| `probe.go` | ffprobe wrapper |
| `presets.go` | Built-in encoding presets |
| `store.go` | Atomic JSON queue file persistence (coalesced writes) |
| `verify.go` | Output verification and post-queue hooks |
| `frames.go` | Frame extraction and caching |
| `system.go` | Hardware report for `/api/system`: CPU/memory/load, GPU devices, per-family hardware encoder availability, live ffmpeg process usage tagged with the job that owns each process |
| `exec.go` | Process execution helpers |
| `web/` | Frontend — vanilla JS/CSS/HTML, no framework, no build step |
| `web/app.js` | Main application logic |
| `web/styles.css` | Styles |
| `web/index.html` | Single-page HTML shell |

## Architecture

- **Single encode at a time** — one worker runs ffmpeg; it saturates the CPU on its own.
- **SSE (Server-Sent Events)** push real-time progress to the browser.
- **Queue persists to `queue.json`** — survives crashes via atomic writes (temp file + rename).
- **Crash recovery** — running jobs reset to queued; partial output deleted.
- **Path sandboxing** — all file access is restricted to `-root` and upload folder; symlinks resolved before check.
- **Frame cache** — keyed by file identity + timestamp + width + filters; avoids re-running ffmpeg.

## API Conventions

- Routes registered with Go 1.22+ method patterns: `"GET /api/jobs"`, `"POST /api/jobs/{id}/cancel"`.
- JSON request/response with `application/json` content type.
- Errors return `{"error": "message"}` with appropriate HTTP status codes.
- Path values accessed via `r.PathValue("id")`.

## Conventions

- **No external dependencies** — pure Go stdlib. Do not add `go get` imports.
- **Web assets embedded** — `//go:embed web` in `main.go`. Changes to `web/` take effect on rebuild.
- **Spec type** is the central config object passed between frontend and backend for encoding settings.
- **Job states**: `queued`, `running`, `done`, `failed`, `cancelled`.
- **Naming**: output names collide gracefully — `clip.mp4`, `clip (1).mp4`, etc. via `uniquePath()`.
- **Container normalization**: only `mp4`, `mkv`, `webm` are accepted; defaults to `mp4`.

## Gotchas

- `-allow-commands` must be passed at startup for post-queue shell commands to work.
- No auth — put behind a reverse proxy if exposed beyond localhost.
- `go.sum` does not exist — this project has zero dependencies.
- ffmpeg 6.0+ required for `-fpsmax` and `-fps_mode` flags.
- Batch encoding does not probe at queue time (deferred to worker).
- `/api/system` figures come from `/proc` (load, memory, per-process CPU): on a host without it those fields are zero (load uses -1) and the UI hides them. The ffmpeg CPU rate needs two samples, so the first response after a restart reports `sampled: false`.
- A running job's ffmpeg is found by the PID the manager recorded in `Job.ffmpegPID` (runtime only, never written to `queue.json`), not by matching process names, so the job row reports its own encode even when the ffmpeg binary is renamed or wrapped.
- Editing a running job requires cancelling it first.
