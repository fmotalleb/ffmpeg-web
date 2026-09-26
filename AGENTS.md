# Project knowledge

This file gives Freebuff context about your project: goals, commands, conventions, and gotchas.

## Quickstart
- Setup: `go generate ./... && go build -o ffmpeg-web .` (requires Go 1.27+, Node.js 22+, ffmpeg/ffprobe on PATH)
- Dev frontend: `cd web && npm run dev` (Vite dev server at http://localhost:5173)
- Dev backend: `go run . --root ~/Videos --out ~/Videos/encoded` then open http://127.0.0.1:8723
- Test: `cd web && npm run build` then `go vet ./...`, `go build ./...` and `golangci-lint run`
- Lint: `golangci-lint run` (v2 config in `.golangci.yml`); `golangci-lint fmt` rewrites formatting
- Container: `docker build -t ffmpeg-web .` — multi-stage: Node builds frontend, Go builds binary, Ubuntu runtime carries ffmpeg
- Release: pushing a `v*` tag runs GoReleaser and pushes a GHCR image

## Architecture
- Key directories: `web/` (React+TypeScript+Vite frontend source), `web-dist/` (build output, gitignored, embedded), root `.go` files (all backend)
- Data flow: Browser → HTTP API (SSE for real-time) → Go server → ffmpeg process → output files; queue persisted to `queue.json`
- Core types: `Spec` (encoding config), `Job` (queue item), `Manager` (queue + worker), `Broker` (SSE events), `Store` (persistence)
- Frontend: React 19 + TypeScript + Zustand (state) + Vite (build). `go generate ./...` runs `npm run build` in `web/`, output goes to `web-dist/` which is `go:embed`-ed into the binary.

## Conventions
- Formatting/linting: standard `gofmt`, checked by `golangci-lint` v2 (`.golangci.yml`)
- Patterns to follow: Go 1.27+ `http.ServeMux` method patterns, `go:embed` for web assets, atomic file writes via temp+rename, path sandboxing via `allowedPath()`
- Things to avoid: don't bypass path sandboxing, don't encode without checking `-allow-commands`
