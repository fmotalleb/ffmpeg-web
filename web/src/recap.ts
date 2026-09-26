import type { MediaInfo, Spec } from "./types";
import { encoderNames, formatBytes, formatDuration } from "./utils";

// The recap in the Summary panel: one line per part of the file, saying what it
// is now and what the encode makes of it. A row with no `becomes` is one the
// encode leaves alone, which is worth saying as plainly as the rest — the point
// is to show the changes, so the same row has to show what it changes from.
export type RecapRow = {
  term: string;
  was?: string;
  becomes?: string;
  kind?: string; // the word for the change, shown with the new value
};

const CODEC_NAMES: Record<string, string> = {
  h264: "H.264",
  avc1: "H.264",
  hevc: "H.265/HEVC",
  h265: "H.265/HEVC",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  mpeg4: "MPEG-4",
  mpeg2video: "MPEG-2",
  vc1: "VC-1",
  prores: "ProRes",
  theora: "Theora",
  aac: "AAC",
  ac3: "AC-3",
  eac3: "E-AC-3",
  dts: "DTS",
  truehd: "TrueHD",
  opus: "Opus",
  vorbis: "Vorbis",
  mp3: "MP3",
  flac: "FLAC",
  pcm_s16le: "PCM",
};

function codecName(codec: string): string {
  return CODEC_NAMES[codec] || codec.toUpperCase();
}

function formatBitrate(bits: number): string {
  if (!bits || bits <= 0) return "";
  return bits >= 1_000_000
    ? `${(bits / 1e6).toFixed(1)} Mbit/s`
    : `${Math.round(bits / 1e3)} kbit/s`;
}

// 29.97, not 29.97…: the frame rate is read off a list, so only the fractional
// ones need decimals kept.
function formatFps(fps: number): string {
  if (!fps || fps <= 0) return "";
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(2);
}

function rateControl(v: Spec["video"]): string {
  return v.rateMode === "quality"
    ? `quality ${v.quality}`
    : `${v.bitrate} kbit/s${v.twoPass ? " · two passes" : ""}`;
}

function filterList(f: Spec["filters"]): string[] {
  return [
    f.deinterlace !== "off" ? `deinterlace (${f.deinterlace})` : "",
    f.denoise !== "off" ? `denoise (${f.denoise})` : "",
    f.sharpen ? "sharpen" : "",
    f.deblock ? "deblock" : "",
    f.rotate ? `rotate ${f.rotate}°` : "",
    f.flipH ? "flip horizontally" : "",
    f.grayscale ? "grayscale" : "",
  ].filter(Boolean);
}

function outputName(source: MediaInfo | null, s: Spec): string {
  const base = s.outputName || (source ? source.name.replace(/\.[^.]+$/, "") : "output");
  return `${base}.${s.container}`;
}

// encodedSeconds is how much of the source ends up in the file once the trim
// range is taken into account.
export function encodedSeconds(source: MediaInfo | null, s: Spec): number {
  if (!source) return 0;
  if (s.trim.enabled && s.trim.end > s.trim.start) return s.trim.end - s.trim.start;
  return source.duration;
}

export function recap(
  source: MediaInfo | null,
  s: Spec,
  dims: { w: number; h: number } | null,
  library?: string,
): RecapRow[] {
  const writes = outputName(source, s);
  if (!source) {
    return [
      { term: "Source", becomes: "nothing chosen yet" },
      { term: "Writes", becomes: writes },
    ];
  }

  const video = source.video;
  const sourceDims = video ? `${video.width}×${video.height}` : "";
  const sourceExt = source.name.split(".").pop()?.toUpperCase() || "";
  const rows: RecapRow[] = [
    {
      term: "Source",
      becomes: [source.name, formatBytes(source.size), formatBitrate(source.bitrate)]
        .filter(Boolean)
        .join(" · "),
    },
    {
      term: "Container",
      was: sourceExt || undefined,
      becomes:
        sourceExt && sourceExt !== s.container.toUpperCase()
          ? s.container.toUpperCase()
          : undefined,
      kind: s.video.encoder === "copy" ? "re-wrapped" : "re-encoded",
    },
    {
      term: "Video",
      was:
        [video ? codecName(video.codec) : "", video?.fps ? `${formatFps(video.fps)} fps` : ""]
          .filter(Boolean)
          .join(" · ") || "no video",
      // With no video stream there is nothing to encode, however the encoder
      // is set — say so rather than listing a plan that cannot happen.
      becomes:
        !video || s.video.encoder === "copy"
          ? undefined
          : [
              encoderNames[s.video.encoder] || s.video.encoder,
              rateControl(s.video),
              s.video.speed,
              library,
              s.video.fpsMode === "off" || s.video.fpsMode === "same"
                ? ""
                : `at ${s.video.fps} fps`,
            ]
              .filter(Boolean)
              .join(" · "),
      kind: "re-encoded",
    },
  ];

  // The picture is only touched if the size, the pixel format or the rotation
  // changes, so the row compares the two sizes rather than assuming one.
  const pixelFormat =
    s.picture.pixelFormat && s.picture.pixelFormat !== (video?.pixelFormat ?? "")
      ? s.picture.pixelFormat
      : "";
  const dimsText = dims ? `${dims.w}×${dims.h}` : "";
  const resized = Boolean(dimsText) && dimsText !== sourceDims;
  const picture = [resized ? dimsText : "", pixelFormat].filter(Boolean);
  const cropped = Boolean(
    s.picture.cropTop || s.picture.cropBottom || s.picture.cropLeft || s.picture.cropRight,
  );
  rows.push({
    term: "Picture",
    was: sourceDims || "no video",
    becomes: video && picture.length ? picture.join(" · ") : undefined,
    kind: resized
      ? s.filters.rotate % 180 === 90
        ? "rotated"
        : cropped
          ? "cropped"
          : "resized"
      : "reformatted",
  });

  // Filters are all picture filters, so without a video track there is nothing
  // for them to do.
  const filters = video ? filterList(s.filters) : [];
  if (filters.length) {
    rows.push({ term: "Filters", was: "none", becomes: filters.join(" · "), kind: "filtered" });
  }

  const tracks = source.audio;
  const track = tracks[s.audio.track] ?? tracks[0] ?? null;
  rows.push({
    term: "Audio",
    was:
      [
        track ? codecName(track.codec) : "",
        track?.channels ? `${track.channels} ch` : "",
        tracks.length > 1 && track ? `track ${track.index + 1} of ${tracks.length}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "no audio",
    becomes:
      s.audio.encoder === "none"
        ? track
          ? "removed"
          : undefined
        : s.audio.encoder === "copy"
          ? undefined
          : [
              s.audio.encoder.toUpperCase(),
              s.audio.mixdown,
              `${s.audio.bitrate} kbit/s`,
              s.audio.gain ? `${s.audio.gain > 0 ? "+" : ""}${s.audio.gain} dB` : "",
              s.audio.normalize ? "volume matched" : "",
            ]
              .filter(Boolean)
              .join(" · "),
    kind: s.audio.encoder === "none" ? "removed" : "re-encoded",
  });

  const subs = source.subtitles.length;
  rows.push({
    term: "Subtitles",
    was: subs ? `${subs} track${subs === 1 ? "" : "s"}` : "none",
    becomes:
      s.subtitle.mode === "burn"
        ? subs
          ? "burned into the picture"
          : undefined
        : s.subtitle.mode === "none" && subs
          ? "left out"
          : undefined,
    kind: s.subtitle.mode === "burn" ? "burned in" : "removed",
  });

  const seconds = encodedSeconds(source, s);
  const shortened = s.trim.enabled && seconds > 0 && seconds < source.duration;
  rows.push({
    term: "Length",
    was: formatDuration(source.duration),
    becomes: shortened ? formatDuration(seconds) : undefined,
    kind: "trimmed",
  });

  rows.push({ term: "Writes", becomes: writes });

  const extras = [s.extra.encoderOptions, s.extra.inputArgs, s.extra.outputArgs].filter(Boolean);
  if (extras.length) {
    rows.push({
      term: "Extra options",
      was: "none",
      becomes: extras.join("  "),
      kind: "raw options",
    });
  }

  return rows;
}
