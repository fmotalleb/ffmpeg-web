# Container image tags

Published to `ghcr.io/fmotalleb/ffmpeg-web` by GoReleaser whenever a `v*` tag is
pushed (`.github/workflows/release.yml` → `go tool goreleaser release`).

The server binary is cross-compiled by GoReleaser (`-trimpath`, version stamped
from `github.com/fmotalleb/go-tools/git`) and copied into an ffmpeg image from
[`jrottenberg/ffmpeg`](https://github.com/jrottenberg/ffmpeg) — the Dockerfile
never builds ffmpeg or the server itself. Every release builds six image
variants from one `Dockerfile`, parameterised by `FFMPEG_VARIANT`.

## Tag scheme

Every variant gets `latest-<variant>`; the `scratch` variant additionally owns
`latest`. On a tagged release each variant also gets its pinned version tag
(`<git tag>-<variant>`).

For a release tagged `v1.2.3`:

| Image | Variant | What it is |
| --- | --- | --- |
| `v1.2.3-scratch` | `scratch` | Alpine, no packages, ffmpeg built from source with vendor libs stripped of symbols. Smallest image. |
| `latest-scratch` | `scratch` | floats with each release |
| `latest` | `scratch` | **the default `latest` tag** — this is what plain `docker pull ghcr.io/fmotalleb/ffmpeg-web` gets you |
| `v1.2.3-alpine` / `latest-alpine` | `alpine` | Alpine 3.20 base with OS vendor libs; ffmpeg built from source. |
| `v1.2.3-ubuntu` / `latest-ubuntu` | `ubuntu` | Ubuntu 24.04 LTS base; vendor libs from apt, ffmpeg from source. |
| `v1.2.3-ubuntu-edge` / `latest-ubuntu-edge` | `ubuntu-edge` | Ubuntu base with *everything* (support libs and ffmpeg) built from source — most codecs, least convenient to maintain. |
| `v1.2.3-vaapi` / `latest-vaapi` | `vaapi` | Ubuntu + Video Acceleration API enabled for Intel/AMD GPU encoding. **amd64 only.** |
| `v1.2.3-nvidia` / `latest-nvidia` | `nvidia` | Ubuntu + NVIDIA hardware encode/decode APIs. **amd64 only.** |

Architectures: every variant is a multi-arch manifest for `linux/amd64` +
`linux/arm64`, except `vaapi` and `nvidia`, which are `linux/amd64` only.
`FFMPEG_VERSION` is pinned to `9` for all variants.

### Choosing a variant

- **Don't know? Use `latest` (scratch).** Smallest image — an Alpine base with
  no packages, ffmpeg built from source with its vendor libs compiled in.
- **Want a shell for debugging, or distro patching?** `alpine` or `ubuntu`.
- **Intel/AMD GPU encode (QSV/VAAPI):** `vaapi`, run with `--device /dev/dri`.
- **NVIDIA GPU encode:** `nvidia`, run with the NVIDIA Container Toolkit
  (`--gpus all`) and host NVIDIA drivers.
- **Maximal codec coverage:** `ubuntu-edge` — same as `ubuntu` but every
  dependency is built from source rather than taken from apt.

## Prereleases

`.goreleaser.yaml` sets `release.prerelease: auto`, so a tag like `v1.3.0-rc1`
produces a GitHub prerelease — but the images still get pushed in full: for a
`v1.3.0-rc1` tag, `v1.3.0-rc1-scratch`, `v1.3.0-rc1-alpine`, … **and** `latest`
plus every `latest-*` all point at the RC.

`dockers_v2` has no `skip_push` option (that was the old `dockers` config; the
v2 struct only has `disable`), so if you want mutable tags to stay on the last
stable release, template them out — empty tags are ignored by `dockers_v2`:

```yaml
tags:
  - "{{ .Tag }}-scratch"
  - "{{ if not .Prerelease }}latest-scratch{{ end }}"
  - "{{ if not .Prerelease }}latest{{ end }}"
```

`.Prerelease` is the semver prerelease string (e.g. `rc1`), empty on stable
tags. A per-image `disable: "{{ if .Prerelease }}true{{ end }}"` works too, but
that skips the versioned tags as well.

## Snapshot builds

`goreleaser release --snapshot` (or `goreleaser build --snapshot --clean`)
builds the images but pushes nowhere; buildx can't create a manifest without
pushing, so GoReleaser instead tags the separate per-platform images with a
`-amd64` / `-arm64` suffix. Note that the snapshot version template here is
`{{ incpatch .Version }}-next`, so the tag looks like
`ffmpeg-web:0.2.1-next-amd64`. And because `dockers_v2` runs in the *publish*
phase, `goreleaser build` and `--skip=publish` build no images at all.
Locally, `docker build -t ffmpeg-web --build-arg FFMPEG_VARIANT=ubuntu .`
is the fastest way to test a variant.

## Running

```sh
docker run --rm -p 8723:8723 -v "$PWD/videos:/data" ghcr.io/fmotalleb/ffmpeg-web:latest
```

- The entrypoint is `/bin/ffmpeg-web` with env vars resembling
  `--address=0.0.0.0:8723 --root=/data --out=/data/encoded`; append flags to override
  (e.g. `ghcr.io/fmotalleb/ffmpeg-web:latest -root=/media`).
- `/data` is declared a `VOLUME`, so bind-mount it if you want the encodes and
  `queue.json` to survive container restarts.
- GPU variants need the device passthrough shown above; the ffmpeg binaries
  live under `/opt/ffmpeg/bin` in the base image, so `-ffmpeg`/`-ffprobe`
  rarely need overriding.

## Notes on the scheme

- The base-image tags follow `ffmpeg-<version>-<variant>` from the
  [jrottenberg/ffmpeg](https://github.com/jrottenberg/ffmpeg) table (e.g.
  `9-scratch320`, `9-alpine320`, `9-ubuntu2404`, `9-vaapi2404`, `9-nvidia2404`);
  the tag on *our* image is always `ghcr.io/fmotalleb/ffmpeg-web:<something>-<variant>`,
  so the variant suffix is how you tell images apart here, not the OS.
- The binary inside the image is the same one distributed in the release
  archives (`checksums.txt` covers it); the image only adds ffmpeg.
