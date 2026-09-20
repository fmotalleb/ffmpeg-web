# Project knowledge

This file gives Freebuff context about your project: goals, commands, conventions, and gotchas.

## Quickstart
- Setup: `go build -o transcoder .` (requires Go 1.27+, ffmpeg/ffprobe on PATH)
- Dev: `go run . -root ~/Videos -out ~/Videos/encoded` then open http://127.0.0.1:8723
- Test: no test files exist yet; run `go vet ./...`, `go build ./...` and `golangci-lint run` to check correctness
- Lint: `golangci-lint run` (v2 config in `.golangci.yml`); `golangci-lint fmt` rewrites formatting
- Container: `docker build -t ffmpeg-web .` — the image carries ffmpeg and ffprobe
- Release: pushing a `v*` tag runs GoReleaser and pushes a GHCR image

## Architecture
- Key directories: `web/` (vanilla JS/CSS/HTML frontend, no build step), root `.go` files (all backend)
- Data flow: Browser → HTTP API (SSE for real-time) → Go server → ffmpeg process → output files; queue persisted to `queue.json`
- Core types: `Spec` (encoding config), `Job` (queue item), `Manager` (queue + worker), `Broker` (SSE events), `Store` (persistence)

## Conventions
- Formatting/linting: standard `gofmt`, checked by `golangci-lint` v2 (`.golangci.yml`)
- Patterns to follow: Go 1.27+ `http.ServeMux` method patterns, `go:embed` for web assets, atomic file writes via temp+rename, path sandboxing via `allowedPath()`
- Things to avoid: no external dependencies (pure stdlib), don't add `go get` imports, don't bypass path sandboxing, don't encode without checking `-allow-commands`
