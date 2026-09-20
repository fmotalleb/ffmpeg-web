# TODO

## DevEX

- [x] add go-releaser + Dockerfile + gh Actions
      `.goreleaser.yaml` builds Linux/macOS/Windows archives, `Dockerfile`
      packages the server with ffmpeg, `.github/workflows/{ci,release}.yml`
      run the checks and publish on `v*` tags
- [x] add golangci-lint v2 support
      `.golangci.yml`; run `golangci-lint run` and `golangci-lint fmt`

## Process Control

- [ ] fix: pause/resume process
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
- [ ] force-kill job
- [ ] preserve process/job state across application restart
- [ ] show FFmpeg command and execution logs per job

## Frame Inspector

- [ ] add per-job preview page
- [ ] select timestamp using:
      - [ ] timeline
      - [ ] timestamp input
      - [ ] frame step forward/backward

- [ ] generate source and target frame
- [ ] comparison modes:
      - [ ] side-by-side
      - [ ] draggable vertical split
      - [ ] opacity overlay
      - [ ] difference
      - [ ] flicker / rapid source-target switching

- [ ] draggable comparison divider

- [ ] swap source/target display
- [ ] keyboard shortcut for source/target swap
- [ ] keyboard shortcut for next/previous frame

- [ ] magnifier
      - [ ] configurable zoom level (using scroll)
      - [ ] click/drag magnifier
      - [ ] source/target toggle inside magnifier using click

- [ ] fullscreen preview

- [ ] download source frame
- [ ] download target frame
- [ ] download diff image

- [ ] generate preview thumbnails for source/target
- [ ] by default get the count and scale of the frames from user, 
- [ ] thumbnail timeline
- [ ] cache generated frames

## Job Queue

- [ ] per-job preview
- [ ] per-job configuration
- [ ] edit queued job
- [ ] duplicate job
- [ ] retry failed job
- [ ] cancel job
- [ ] delete job
- [ ] reorder queued jobs
- [ ] show progress
- [ ] show ETA
- [ ] show encoding speed
- [ ] show output size
- [ ] show FFmpeg command

- [ ] prevent editing jobs that are already running
- [ ] optionally allow "duplicate and edit" for running/completed jobs


## Configuration

- [ ] read configuration exclusively from environment variables
- [ ] do not use godotenv
- [ ] document all environment variables
- [ ] validate configuration at startup
- [ ] expose effective non-secret configuration in UI/API


## Presets

- [ ] load custom presets from configurable directory
- [ ] validate preset files
- [ ] expose presets in job creation UI
- [ ] create preset from UI
- [ ] edit preset from UI
- [ ] duplicate preset
- [ ] delete preset
- [ ] import/export preset
- [ ] preset versioning
- [ ] mark built-in presets as read-only

- [ ] validate preset before saving
- [ ] prevent arbitrary command execution through preset fields