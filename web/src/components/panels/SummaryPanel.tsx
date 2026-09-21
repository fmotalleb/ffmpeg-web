import { useStore } from "../../store";
import { TrimRange } from "../TrimRange";
import {
  codecForEncoder,
  encoderNames,
  formatDuration,
  librariesForCodec,
  parseTimecode,
} from "../../utils";

function outputDimensions(
  source: ReturnType<typeof useStore.getState>["source"],
  settings: ReturnType<typeof useStore.getState>["settings"],
) {
  const src = source;
  const pic = settings.picture;
  if (!src || !src.video) return null;
  let w = src.video.width - pic.cropLeft - pic.cropRight;
  let h = src.video.height - pic.cropTop - pic.cropBottom;
  if (w <= 0 || h <= 0) return null;

  if (pic.scaleMode === "custom" && pic.width > 0 && pic.height > 0) {
    if (pic.keepAspect && !pic.pad) {
      const ratio = Math.min(pic.width / w, pic.height / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    } else {
      w = pic.width;
      h = pic.height;
    }
  }
  if (settings.filters.rotate % 180 === 90) [w, h] = [h, w];
  return { w: w - (w % 2), h: h - (h % 2) };
}

function encodedSeconds(
  source: ReturnType<typeof useStore.getState>["source"],
  settings: ReturnType<typeof useStore.getState>["settings"],
) {
  if (!source) return 0;
  const trim = settings.trim;
  if (trim.enabled && trim.end > trim.start) return trim.end - trim.start;
  return source.duration;
}

export function SummaryPanel() {
  const source = useStore((s) => s.source);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const encoders = useStore((s) => s.encoders);

  const dims = outputDimensions(source, settings);
  const s = settings;
  const names = encoderNames;
  const library = librariesForCodec(
    encoders,
    codecForEncoder[s.video.encoder] || "",
  ).find((l) => l.id === s.video.library);
  const rows: [string, string][] = [
    ["Source", source ? source.name : "nothing chosen yet"],
    [
      "Video",
      s.video.encoder === "copy"
        ? "copied as-is"
        : `${names[s.video.encoder] || s.video.encoder} \u00b7 ${
            s.video.rateMode === "quality"
              ? `quality ${s.video.quality}`
              : `${s.video.bitrate} kbit/s${s.video.twoPass ? " \u00b7 two passes" : ""}`
          } \u00b7 ${s.video.speed}${library ? ` \u00b7 ${library.name}` : ""}`,
    ],
    ["Picture", dims ? `${dims.w}\u00d7${dims.h}` : "\u2014"],
    [
      "Audio",
      s.audio.encoder === "none"
        ? "removed"
        : s.audio.encoder === "copy"
          ? "copied as-is"
          : `${s.audio.encoder.toUpperCase()} ${s.audio.bitrate} kbit/s \u00b7 ${s.audio.mixdown}`,
    ],
    [
      "Subtitles",
      ({ none: "left out", copy: "kept as a track", burn: "burned in" } as Record<string, string>)[
        s.subtitle.mode
      ] || s.subtitle.mode,
    ],
    ["Length", formatDuration(encodedSeconds(source, settings))],
    [
      "Writes",
      `${s.outputName || (source ? source.name.replace(/\.[^.]+$/, "") : "output")}.${s.container}`,
    ],
  ];

  const extras = [s.extra.encoderOptions, s.extra.inputArgs, s.extra.outputArgs].filter(Boolean);
  if (extras.length) rows.push(["Extra options", extras.join("  ")]);

  return (
    <section className="panel is-active">
      <div className="grid">
        <label className="field">
          <span>Save as</span>
          <input
            type="text"
            value={s.outputName}
            onChange={(e) => updateSettings("outputName", e.target.value)}
            placeholder="same name as the source"
          />
        </label>
        <label className="field">
          <span>Container</span>
          <select
            value={s.container}
            onChange={(e) => updateSettings("container", e.target.value)}
          >
            <option value="mp4">MP4</option>
            <option value="mkv">MKV</option>
            <option value="webm">WebM</option>
          </select>
        </label>
        <label className="field check">
          <input
            type="checkbox"
            checked={s.webOptimize}
            onChange={(e) => updateSettings("webOptimize", e.target.checked)}
          />
          <span>Start playing before the file finishes downloading</span>
        </label>
      </div>

      <h3 className="group-title">Encode only part of the video</h3>
      <div className="grid">
        <label className="field check">
          <input
            type="checkbox"
            checked={s.trim.enabled}
            onChange={(e) => updateSettings("trim.enabled", e.target.checked)}
          />
          <span>Trim to a range</span>
        </label>
        <label className="field">
          <span>Start</span>
          <input
            type="text"
            value={
              s.trim.start > 0
                ? `${Math.floor(s.trim.start / 60)}:${String(Math.round(s.trim.start) % 60).padStart(2, "0")}`
                : ""
            }
            onChange={(e) => updateSettings("trim.start", parseTimecode(e.target.value))}
            placeholder="0:00"
          />
        </label>
        <label className="field">
          <span>End</span>
          <input
            type="text"
            value={
              s.trim.end > 0
                ? `${Math.floor(s.trim.end / 60)}:${String(Math.round(s.trim.end) % 60).padStart(2, "0")}`
                : ""
            }
            onChange={(e) => updateSettings("trim.end", parseTimecode(e.target.value))}
            placeholder="end of video"
          />
        </label>
      </div>

      <p className="note">
        Or drag the two handles below. Hold one for half a second and the frame
        underneath it appears, so you can see exactly where the cut lands.
      </p>
      <TrimRange />

      <h3 className="group-title">What will happen</h3>
      <dl className="recap">
        {rows.map(([term, value]) => (
          <span key={term} style={{ display: "contents" }}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </span>
        ))}
      </dl>
    </section>
  );
}
