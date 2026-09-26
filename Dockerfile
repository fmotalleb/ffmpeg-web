ARG FFMPEG_VERSION=9
ARG FFMPEG_VARIANT=scratch # vaapi, nvidia, ubuntu, ubuntu-edge, alpine

# Using base image from https://github.com/jrottenberg/ffmpeg/pkgs/container/ffmpeg
FROM --platform=$BUILDPLATFORM ghcr.io/jrottenberg/ffmpeg:${FFMPEG_VERSION}-${FFMPEG_VARIANT}

ARG TARGETPLATFORM
COPY $TARGETPLATFORM/ffmpeg-web /bin/ffmpeg-web

ENV HOME=/data

WORKDIR /data

VOLUME ["/data"]

EXPOSE 8723

ENTRYPOINT ["/bin/ffmpeg-web"]
ENV LISTEN=0.0.0.0:8723 \
    BASE_DIR=/data \
    OUTPUT_DIR=/data/encoded \
    ALLOW_COMMAND=false \
    MAX_UPLOAD_SIZE=16000000000
