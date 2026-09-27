// The chip has room for a word, not for "Intel Quick Sync (hardware)".
export const SHORT_NAME: Record<string, string> = {
  nvenc: "NVENC",
  qsv: "Quick Sync",
  vaapi: "VAAPI",
  videotoolbox: "VideoToolbox",
  amf: "AMF",
};

export function Bar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const level = clamped >= 85 ? " is-critical" : clamped >= 60 ? " is-hot" : "";
  return (
    <div className={`hw-bar${level}`}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Dot({ on }: { on: boolean }) {
  return <span className={`hw-dot ${on ? "on" : "off"}`} />;
}
