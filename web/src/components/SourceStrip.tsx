import { useStore } from "../store";
import { formatBytes, formatDuration } from "../utils";

export function SourceStrip() {
  const source = useStore((s) => s.source);
  const setProbe = useStore((s) => s.setProbe);

  if (!source) {
    return (
      <div className="source source-empty">
        <p className="source-empty-text">
          Pick a video or a folder to start. Nothing on disk changes until you
          queue an encode.
        </p>
      </div>
    );
  }

  const v = source.video;
  const facts: [string, string | number][] = [
    ["Length", formatDuration(source.duration)],
    ["Picture", v ? `${v.width}\u00d7${v.height}` : "\u2014"],
    [
      "Framerate",
      v && v.fps
        ? `${v.fps.toFixed(3).replace(/\.?0+$/, "")} fps`
        : "\u2014",
    ],
    ["Video", v ? v.codec : "\u2014"],
    [
      "Audio",
      source.audio.length
        ? `${source.audio.length} track${source.audio.length > 1 ? "s" : ""}`
        : "none",
    ],
    ["Subtitles", source.subtitles.length || "none"],
    ["Size", formatBytes(source.size)],
    ["Scan", v && v.interlaced ? "interlaced" : "progressive"],
  ];

  return (
    <div className="source">
      <p className="source-name">{source.name}</p>
      {facts.map(([label, value]) => (
        <span key={label} className="source-fact">
          {label} <b>{value}</b>
        </span>
      ))}
      <button
        className="btn btn-small btn-quiet"
        onClick={() =>
          setProbe(
            true,
            source.name,
            `/api/probe/raw?path=${encodeURIComponent(source.path)}`,
          )
        }
      >
        All details
      </button>
    </div>
  );
}
