# TODO

## DevEX

- [x] add go-releaser + Dockerfile + gh Actions
      `.goreleaser.yaml` builds Linux/macOS/Windows archives, `Dockerfile`
      packages the server with ffmpeg, `.github/workflows/{ci,release}.yml`
      run the checks and publish on `v*` tags
- [x] add golangci-lint v2 support
      `.golangci.yml`; run `golangci-lint run` and `golangci-lint fmt`

## Process Control

- [x] fix: pause/resume process (should freeze ffmpeg process)
- [ ] feat: pause/resume after this job
- [ ] expose process state:
      queued
      starting
      running
      paused
      stopping
      completed
      failed
      cancelled

- [ ] graceful job cancellation
- [x] force-kill job
- [x] preserve process/job state across application restart
- [x] show FFmpeg command and execution logs per job

## Frame Inspector

- [x] add per-job preview page
- [x] select timestamp using:
      - [x] timeline
      - [x] timestamp input (buggy, wont change the timeline)
      - [x] frame step forward/backward

- [x] generate source and target frame
- [x] comparison modes:
      - [x] side-by-side
      - [x] draggable vertical split
      - [x] opacity overlay
      - [x] difference
      - [x] flicker / rapid source-target switching

- [x] draggable comparison divider

- [x] swap source/target display
- [x] keyboard shortcut for source/target swap
- [x] keyboard shortcut for next/previous frame

- [x] magnifier
      - [x] configurable zoom level (using scroll)
      - [x] click/drag magnifier
      - [x] source/target toggle inside magnifier using click
      - [ ] display which one of source or target are being previewed right now

- [x] fullscreen preview

- [x] download source frame
- [x] download target frame
- [x] download diff image

- [x] generate preview thumbnails for source/target
- [x] by default get the count and scale of the frames from user,
- [x] thumbnail timeline
- [x] cache generated frames

## Job Queue

- [x] per-job preview
- [x] per-job configuration
- [x] edit queued job
- [ ] duplicate job
- [x] retry failed job
- [x] cancel job
- [x] delete job
- [ ] reorder queued jobs
- [x] show progress
- [x] show ETA
- [x] show encoding speed
- [x] show approximate output size (with a per-second refresh rate or less due to need for stat syscall on open file)
- [x] show FFmpeg command

- [x] prevent editing jobs that are already running
- [ ] optionally allow "duplicate and edit" for running/completed jobs

- [x] refactor job queue display

## Configuration

- [x] read configuration from environment variables
- [x] document all environment variables
- [x] validate configuration at startup
- [ ] expose effective non-secret configuration in UI/API

## Presets

- [x] load custom presets from configurable directory
- [ ] validate preset files
- [ ] expose presets in job creation UI
- [ ] create preset from UI
- [ ] edit preset from UI
- [ ] duplicate preset
- [ ] delete preset
- [ ] import/export preset
- [ ] preset versioning
- [x] mark built-in presets as read-only

- [ ] validate preset before saving
- [ ] prevent arbitrary command execution through preset fields

## Misc

- [ ] background job count limiter (ffmpeg spawner for preview or worker)
- [x] add subtitle to video, and subtitle metadata
- [ ] tests for ffmpeg command generator
- [x] display ffprobe's results more elegantly
- [x] switch logging to zaplog (instance builder using github.com/fmotalleb/go-tools)
- [x] switch cli framework to cobra (switched to github.com/fmotalleb/varg as a simpler alternative)
