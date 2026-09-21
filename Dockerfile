# Build the single static binary, then run it on a small image that has
# ffmpeg and ffprobe on PATH. The web assets are embedded, so nothing else
# needs to be copied across.
#
#   docker build -t ffmpeg-web .
#   docker run --rm -p 8723:8723 -v "$PWD/videos:/media" ffmpeg-web
#
# Mounted folders must be writable by uid 10001 (the user the container runs
# as): `chown -R 10001 "$PWD/videos"`.

FROM node:22-alpine AS frontend

WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build


FROM golang:1.27-alpine AS build

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .
COPY --from=frontend /src/web-dist ./web-dist

ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath \
        -ldflags "-s -w -X main.version=${VERSION}" \
        -o /out/transcoder .


FROM ubuntu:26.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
        wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd \
        --uid 10001 \
        --create-home \
        --home-dir /data \
        --shell /usr/sbin/nologin \
        transcoder \
    && mkdir -p /media /data/encoded \
    && chown -R transcoder:transcoder /media /data

COPY --from=build /out/transcoder /usr/local/bin/transcoder

ENV HOME=/data
WORKDIR /data

USER transcoder

# /media is what the browser may read from, /data holds the encodes and the
# queue file.
VOLUME ["/media", "/data"]
EXPOSE 8723

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD wget -q -O - http://127.0.0.1:8723/api/config >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/local/bin/transcoder"]
CMD ["-addr=0.0.0.0:8723", "-root=/media", "-out=/data/encoded"]
