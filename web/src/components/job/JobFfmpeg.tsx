import { useStore } from "../../store";
import { POLL_MS, useJobFfmpeg } from "../../system";
import { formatBytes } from "../../utils";

// JobFfmpeg reports the process this job is encoding with. The server tags
// each running ffmpeg it reads out of the process table with the job that
// started it, so this is that job's own process and not another ffmpeg that
// happens to be running on the same machine.
export function JobFfmpeg({ jobId }: { jobId: string }) {
  const { status, error, process: proc, cpu, rss } = useJobFfmpeg(jobId);

  if (!proc) {
    // Before the platform reports the process, say why rather than showing a
    // zero: no sample yet, no report at all, or a platform that has no /proc.
    const note = error
      ? "status unavailable"
      : !status || status.os === "linux"
        ? "starting\u2026"
        : "not reported on this platform";
    return (
      <div className="job-ffmpeg">
        <span className="job-ffmpeg-label">ffmpeg</span>
        <span className="job-ffmpeg-value">{note}</span>
      </div>
    );
  }

  return (
    <div className="job-ffmpeg" title="The ffmpeg process this job is running">
      <span className="job-ffmpeg-label">ffmpeg</span>
      <span className="job-ffmpeg-value">pid {proc.pid}</span>
      <button
        className="btn btn-small btn-quiet job-log-btn"
        title="Tail this ffmpeg process's log"
        onClick={() => useStore.getState().setLogView(proc.pid, `pid ${proc.pid}`)}
      >
        Log
      </button>
      <span>{proc.sampled ? `CPU: ${Math.round(proc.cpu)}%` : "measuring cpu\u2026"}</span>
      <Sparkline
        values={cpu}
        tone="cpu"
        perCore
        label="CPU"
        format={(value) => `${Math.round(value)}%`}
      />
      <span>{`RAM: ${formatBytes(proc.rss)}`}</span>
      <Sparkline values={rss} tone="ram" label="Memory" format={formatBytes} />
      <span>{proc.threads} threads</span>
    </div>
  );
}

// Sparkline draws where one reading has been over the last couple of minutes.
// CPU is scaled to whole cores, so its dashed line is a single core and a curve
// above it is the encoder spreading over several; memory has no such ceiling,
// so it is scaled to its own window.
function Sparkline({
  values,
  tone,
  label,
  format,
  perCore,
}: {
  values: number[];
  tone: "cpu" | "ram";
  label: string;
  format: (value: number) => string;
  perCore?: boolean;
}) {
  if (values.length < 2) return null;

  const width = 46;
  const height = 13;
  const pad = 1.5;
  const inner = height - pad * 2;
  const seconds = Math.round((values.length * POLL_MS) / 1000);
  const latest = values[values.length - 1];
  const peak = Math.max(...values);
  // A little headroom on a series with no ceiling of its own, so a memory that
  // barely moves is a line near the top rather than a flat edge.
  const scale = perCore ? Math.max(100, Math.ceil(peak / 100) * 100) : Math.max(peak * 1.1, 1);
  const step = (width - pad * 2) / (values.length - 1);
  const y = (value: number) => pad + inner - (Math.min(value, scale) / scale) * inner;
  const points = values.map((value, i) => `${(pad + i * step).toFixed(1)} ${y(value).toFixed(1)}`);

  return (
    <svg
      className={`job-spark ${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label} of this job's ffmpeg over the last ${seconds} seconds`}
    >
      <title>
        {`${label}: ${format(latest)} now, peak ${format(peak)} over the last ${seconds}s`}
      </title>
      <polygon
        className="job-spark-fill"
        points={`${pad} ${height - pad} ${points.join(" ")} ${width - pad} ${height - pad}`}
      />
      {scale > 100 && (
        <line className="job-spark-core" x1={pad} x2={width - pad} y1={y(100)} y2={y(100)} />
      )}
      <polyline className="job-spark-line" points={points.join(" ")} />
    </svg>
  );
}
