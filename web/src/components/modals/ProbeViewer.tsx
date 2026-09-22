import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../store";
import { api } from "../../api";
import { formatBytes, formatDuration, baseName } from "../../utils";

type Tags = Record<string, string>;

interface ProbeFormat {
  filename?: string;
  format_name?: string;
  format_long_name?: string;
  start_time?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  probe_score?: number;
  nb_streams?: number;
  tags?: Tags;
  [k: string]: unknown;
}

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  field_order?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  nb_frames?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bit_rate?: string;
  display_aspect_ratio?: string;
  color_space?: string;
  disposition?: Record<string, number>;
  tags?: Tags;
  [k: string]: unknown;
}

interface ProbeData {
  streams?: ProbeStream[];
  format?: ProbeFormat;
  [k: string]: unknown;
}

const DASH = "\u2014";
const STREAM_LABELS: Record<string, string> = {
  video: "Video",
  audio: "Audio",
  subtitle: "Subtitles",
  data: "Data",
  attachment: "Attachments",
};

export function ProbeViewer() {
  const probeOpen = useStore((s) => s.probeOpen);
  const probeTitle = useStore((s) => s.probeTitle);
  const probeUrl = useStore((s) => s.probeUrl);
  const setProbe = useStore((s) => s.setProbe);

  const [data, setData] = useState<ProbeData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"summary" | "json">("summary");

  useEffect(() => {
    if (!probeOpen || !probeUrl) return;
    setData(null);
    setError("");
    setTab("summary");
    api(probeUrl)
      .then((d: unknown) => setData(d as ProbeData))
      .catch((err: unknown) => setError((err as Error).message));
  }, [probeOpen, probeUrl]);

  if (!probeOpen) return null;

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) setProbe(false);
      }}
    >
      <div className="modal-card probe-modal" role="dialog" aria-modal="true" aria-labelledby="probe-title">
        <header className="modal-head">
          <h2 id="probe-title">{probeTitle}</h2>
          <button className="btn btn-quiet" onClick={() => setProbe(false)}>
            Close
          </button>
        </header>
        {data ? (
          <>
            <nav className="probe-tabs" role="tablist" aria-label="Probe views">
              <button
                role="tab"
                aria-selected={tab === "summary"}
                className={"probe-tab" + (tab === "summary" ? " is-active" : "")}
                onClick={() => setTab("summary")}
              >
                Summary
              </button>
              <button
                role="tab"
                aria-selected={tab === "json"}
                className={"probe-tab" + (tab === "json" ? " is-active" : "")}
                onClick={() => setTab("json")}
              >
                JSON
              </button>
            </nav>
            <div className="probe-scroll">
              {tab === "summary" ? <Summary data={data} /> : <JSONTab key={probeUrl} data={data} />}
            </div>
          </>
        ) : error ? (
          <p className="probe-note probe-error">{error}</p>
        ) : (
          <p className="probe-note">Reading\u2026</p>
        )}
      </div>
    </div>
  );
}

// ---- summary view ----

function Summary({ data }: { data: ProbeData }) {
  const fmt = data.format;
  const streams = data.streams ?? [];
  return (
    <div className="probe-summary">
      <section className="probe-card">
        <div className="probe-card-head">
          <span className="probe-card-title">Container</span>
          {fmt?.format_name && <span className="probe-tag">{fmt.format_name}</span>}
        </div>
        <dl className="probe-facts">
          <Fact label="File" value={baseName(fmt?.filename || "")} title={fmt?.filename} />
          <Fact label="Format" value={fmt?.format_long_name} />
          <Fact label="Size" value={bytesOf(fmt?.size)} />
          <Fact label="Duration" value={durationOf(fmt?.duration)} />
          <Fact label="Bit rate" value={bitrateOf(fmt?.bit_rate)} />
          <Fact label="Start time" value={secondsOf(fmt?.start_time)} />
        </dl>
        {fmt?.tags && Object.keys(fmt.tags).length > 0 && (
          <Chips entries={formatChipEntries(fmt.tags)} />
        )}
      </section>

      {streams.length > 0 && (
        <>
          <h4 className="probe-streams-title">
            Streams <span>{streams.length}</span>
          </h4>
          {streams.map((st, i) => (
            <StreamCard key={st.index ?? i} st={st} />
          ))}
        </>
      )}
    </div>
  );
}

function StreamCard({ st }: { st: ProbeStream }) {
  const type = st.codec_type && STREAM_LABELS[st.codec_type] ? st.codec_type : "other";
  const isVideo = type === "video";
  const isAudio = type === "audio";
  const lang = st.tags?.language;
  const disp = st.disposition ?? {};
  const chips: [string, string][] = [];
  if (disp.default === 1) chips.push(["default", ""]);
  if (disp.forced === 1) chips.push(["forced", ""]);
  return (
    <section className="probe-card probe-stream-card">
      <div className="probe-card-head">
        <span className={`probe-badge sb-${type}`}>{STREAM_LABELS[type] ?? "Stream"}</span>
        <span className="probe-stream-title">
          {st.codec_long_name || st.codec_name || "Unknown codec"}
        </span>
        <span className="probe-stream-index">
          {st.index !== undefined ? `Stream #0:${st.index}` : ""}
        </span>
      </div>
      <dl className="probe-facts">
        {isVideo && (
          <>
            {st.width ? (
              <Fact label="Resolution" value={`${st.width}\u00d7${st.height}`} />
            ) : (
              <Fact label="Resolution" value={DASH} />
            )}
            <Fact label="Aspect" value={aspectOf(st)} />
            <Fact label="Frame rate" value={fpsOf(st.avg_frame_rate || st.r_frame_rate)} />
            <Fact label="Pixel format" value={st.pix_fmt} />
            {st.field_order && st.field_order !== "progressive" && (
              <Fact label="Interlacing" value={st.field_order} />
            )}
            {st.color_space && <Fact label="Color space" value={st.color_space} />}
          </>
        )}
        {isAudio && (
          <>
            {st.channels ? (
              <Fact
                label="Channels"
                value={
                  st.channel_layout
                    ? `${st.channels} ch \u00b7 ${st.channel_layout}`
                    : `${st.channels} ch`
                }
              />
            ) : (
              <Fact label="Channels" value={DASH} />
            )}
            <Fact label="Sample rate" value={sampleRateOf(st.sample_rate)} />
          </>
        )}
        {st.profile && <Fact label="Profile" value={st.profile} />}
        <Fact label="Bit rate" value={bitrateOf(st.bit_rate)} />
        {st.duration && <Fact label="Duration" value={durationOf(st.duration)} />}
        {st.nb_frames && <Fact label="Frames" value={st.nb_frames} />}
        {lang && <Fact label="Language" value={lang} />}
        {st.tags?.title && <Fact label="Title" value={st.tags.title} />}
      </dl>
      {chips.length > 0 && <Chips entries={chips} />}
    </section>
  );
}

function Fact({ label, value, title }: { label: string; value?: string; title?: string }) {
  return (
    <div className="probe-fact">
      <dt>{label}</dt>
      <dd title={title}>{value || DASH}</dd>
    </div>
  );
}

function Chips({ entries }: { entries: [string, string][] }) {
  return (
    <div className="probe-chips">
      {entries.map(([k, v]) => (
        <span className="probe-chip" key={k + v}>
          <em>{labelize(k)}</em>
          {v}
        </span>
      ))}
    </div>
  );
}

function formatChipEntries(tags: Tags): [string, string][] {
  const order = ["title", "encoder", "creation_time", "language", "handler_name"];
  const entries = Object.entries(tags).sort(
    (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]),
  );
  const head = entries.filter(([k]) => order.includes(k));
  const rest = entries.filter(([k]) => !order.includes(k));
  return [...head, ...rest];
}

// ---- json tree view ----

function JSONTab({ data }: { data: ProbeData }) {
  const paths = useMemo(() => collectContainerPaths(data, "", []), [data]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const isOpen = (path: string, depth: number) => open[path] ?? depth <= 2;
  const toggle = (path: string, depth: number) =>
    setOpen((o) => ({ ...o, [path]: !isOpen(path, depth) }));
  const expandAll = () =>
    setOpen(Object.fromEntries(paths.map((p) => [p, true])));
  const collapseAll = () =>
    setOpen(Object.fromEntries(paths.map((p) => [p, false])));

  return (
    <div className="probe-json">
      <div className="probe-jsontool">
        <button className="btn btn-small btn-quiet" onClick={expandAll}>
          Expand all
        </button>
        <button className="btn btn-small btn-quiet" onClick={collapseAll}>
          Collapse all
        </button>
        <span className="probe-jsoncount">{paths.length} nodes</span>
      </div>
      <ul className="probe-tree" role="tree">
        {Object.entries(data).map(([k, v]) => (
          <TreeRow key={k} k={k} v={v} path={k} depth={0} isOpen={isOpen} toggle={toggle} />
        ))}
      </ul>
    </div>
  );
}

function TreeRow({
  k,
  v,
  path,
  depth,
  isOpen,
  toggle,
}: {
  k: string;
  v: unknown;
  path: string;
  depth: number;
  isOpen: (path: string, depth: number) => boolean;
  toggle: (path: string, depth: number) => void;
}) {
  if (v === null || typeof v !== "object") {
    return (
      <li role="treeitem">
        <span className="tree-row">
          <span className="tree-gap" />
          <code className="tree-key">{k}</code>
          <code className={`tree-val tv-${leafKind(v)}`}>{leafText(v)}</code>
        </span>
      </li>
    );
  }
  const arr = Array.isArray(v);
  const count = arr ? v.length : Object.keys(v).length;
  const open = isOpen(path, depth);
  return (
    <li role="treeitem" aria-expanded={open}>
      <span className="tree-row">
        <button
          className="tree-tw"
          onClick={() => toggle(path, depth)}
          aria-hidden="true"
          tabIndex={-1}
        >
          {open ? "\u25be" : "\u25b8"}
        </button>
        <code className="tree-key">{k}</code>
        <span className="tree-count">{arr ? `[${count}]` : `{${count}}`}</span>
      </span>
      {open && (
        <ul className="probe-branch" role="group">
          {Object.entries(v as Record<string, unknown>).map(([ck, cv]) => (
            <TreeRow
              key={ck}
              k={ck}
              v={cv}
              path={`${path}.${ck}`}
              depth={depth + 1}
              isOpen={isOpen}
              toggle={toggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function collectContainerPaths(v: unknown, path: string, out: string[]): string[] {
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (val && typeof val === "object") out.push(p);
      collectContainerPaths(val, p, out);
    }
  }
  return out;
}

function leafKind(v: unknown): "s" | "n" | "b" | "z" {
  if (typeof v === "number") return "n";
  if (typeof v === "boolean") return "b";
  if (v === null) return "z";
  return "s";
}

function leafText(v: unknown): string {
  if (typeof v === "string") return `\u201c${v}\u201d`;
  return JSON.stringify(v);
}

// ---- formatting helpers ----

function labelize(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function bytesOf(s?: string): string {
  const n = s ? parseInt(s, 10) : 0;
  return n > 0 ? formatBytes(n) : DASH;
}

function durationOf(s?: string): string {
  const n = s ? parseFloat(s) : 0;
  return n > 0 ? formatDuration(n) : DASH;
}

function bitrateOf(s?: string): string {
  const n = s ? parseInt(s, 10) : 0;
  return n > 0 ? `${Math.round(n / 1000).toLocaleString("en-US")} kbps` : DASH;
}

function secondsOf(s?: string): string {
  const n = s ? parseFloat(s) : NaN;
  return isFinite(n) ? `${n.toFixed(3)} s` : DASH;
}

function sampleRateOf(s?: string): string {
  const n = s ? parseInt(s, 10) : 0;
  return n > 0 ? `${Math.round(n / 1000)} kHz` : DASH;
}

function fpsOf(fraction?: string): string {
  const v = rateOf(fraction);
  return v > 0 ? `${v} fps` : DASH;
}

function rateOf(fraction?: string): number {
  if (!fraction) return 0;
  if (fraction.includes("/")) {
    const [a, b] = fraction.split("/");
    const n = parseFloat(a);
    const d = parseFloat(b);
    if (n && d) return parseFloat((n / d).toFixed(3));
    return 0;
  }
  const n = parseFloat(fraction);
  return isFinite(n) && n > 0 ? parseFloat(n.toFixed(3)) : 0;
}

function aspectOf(st: ProbeStream): string {
  if (st.display_aspect_ratio && /^\d+:\d+$/.test(st.display_aspect_ratio)) {
    return st.display_aspect_ratio;
  }
  const w = st.width ?? 0;
  const h = st.height ?? 0;
  if (w && h) {
    const g = gcd(w, h);
    return `${w / g}:${h / g}`;
  }
  return DASH;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}