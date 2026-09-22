import { useStore } from "../../store";
import { TrimRange } from "../TrimRange";
import { recap } from "../../recap";
import { codecForEncoder, librariesForCodec, parseTimecode } from "../../utils";

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

export function SummaryPanel() {
  const source = useStore((s) => s.source);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const encoders = useStore((s) => s.encoders);

  const dims = outputDimensions(source, settings);
  const s = settings;
  const library = librariesForCodec(
    encoders,
    codecForEncoder[s.video.encoder] || "",
  ).find((l) => l.id === s.video.library);
  const rows = recap(source, s, dims, library?.name);

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

      <h3 className="group-title">What changes</h3>
      <dl className="recap">
        {rows.map((row) => (
          <span key={row.term} style={{ display: "contents" }}>
            <dt>{row.term}</dt>
            <dd>
              {row.was === undefined ? (
                row.becomes
              ) : row.becomes === undefined ? (
                <>
                  <span className="recap-was">{row.was}</span>
                  <span className="recap-tag is-same">unchanged</span>
                </>
              ) : (
                <>
                  <span className="recap-was">{row.was}</span>
                  <span className="recap-arrow" aria-hidden="true">
                    &rarr;
                  </span>
                  <span className="recap-now">{row.becomes}</span>
                  {row.kind && <span className="recap-tag">{row.kind}</span>}
                </>
              )}
            </dd>
          </span>
        ))}
      </dl>
    </section>
  );
}
