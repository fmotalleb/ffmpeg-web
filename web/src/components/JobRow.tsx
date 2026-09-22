import { useStore } from "../store";
import { api, toast } from "../api";
import { POLL_MS, useJobFfmpeg } from "../system";
import { baseName, formatBytes, formatDuration } from "../utils";
import type { Job } from "../types";

const STATUS_LABELS: Record<string, string> = {
  queued: "waiting",
  running: "encoding",
  done: "finished",
  failed: "failed",
  canceled: "cancelled",
};

export function JobRow({ job }: { job: Job }) {
  const setActiveTab = useStore((s) => s.setActiveTab);
  const settings = useStore((s) => s.settings);
  const setProbe = useStore((s) => s.setProbe);
  const queueSettings = useStore((s) => s.queue.settings);

  const threshold = queueSettings?.shrinkThreshold || 20;

  const projectedSize =
    job.outSize > 0 && job.progress > 0.01
      ? Math.round(job.outSize / job.progress)
      : 0;
  const projectedPct =
    job.sourceSize > 0 && projectedSize > 0
      ? (1 - projectedSize / job.sourceSize) * 100
      : 0;

  const handlePreview = async () => {
    useStore.getState().setPreviewJobId(job.id);
    setActiveTab("preview");
  };

  const handleEdit = async () => {
    try {
      const info = await api<import("../types").MediaInfo>("/api/probe", {
        method: "POST",
        body: JSON.stringify({ path: job.source }),
      });
      useStore.getState().setSource(info);
      useStore.setState({
        settings: { ...settings, ...structuredClone(job.spec), input: info.path },
        editingJobId: job.id,
        previewJobId: null,
        presetId: null,
      });
      setActiveTab("summary");
      toast(`Editing ${job.label}`, true);
    } catch (err: unknown) {
      toast((err as Error).message);
    }
  };

  return (
    <article
      className={`job ${job.status}${job.sourceDeleted ? " deleted-source" : ""}`}
    >
      <div className="job-head">
        <span className="job-state">
          {STATUS_LABELS[job.status] || job.status}
        </span>
        <span className="job-title">{job.label || baseName(job.output)}</span>
        {job.status === "queued" && (
          <span className="job-reorder">
            <MoveButton glyph={"\u2191"} id={job.id} delta={-1} />
            <MoveButton glyph={"\u2193"} id={job.id} delta={1} />
            <MoveButton glyph={"\u2912"} id={job.id} delta={0} />
          </span>
        )}
        <div className="job-actions">
          <ActionButton label="Preview" onClick={handlePreview} />
          {job.status !== "running" && (
            <ActionButton label="Edit" onClick={handleEdit} />
          )}
          {(job.status === "running" || job.status === "queued") && (
            <ActionButton
              label="Cancel"
              onClick={() =>
                api(`/api/jobs/${job.id}/cancel`, { method: "POST" })
              }
            />
          )}
          {job.status === "done" && (
            <>
              <a
                className="btn btn-small"
                href={`/api/jobs/${job.id}/file`}
              >
                Download
              </a>
              <ActionButton
                label="Details"
                accent
                onClick={() =>
                  setProbe(
                    true,
                    baseName(job.output),
                    `/api/jobs/${job.id}/probe?which=output`,
                  )
                }
              />
              {!job.sourceDeleted && job.savedPct >= threshold && (
                <ActionButton
                  label={`Delete source (${Math.round(job.savedPct)}% smaller)`}
                  onClick={async () => {
                    if (
                      !confirm(
                        `Delete the original file?\n\n${job.source}\n\nThis cannot be undone.`,
                      )
                    )
                      return;
                    await api(`/api/jobs/${job.id}/delete-source`, {
                      method: "POST",
                    });
                    toast("Source deleted", true);
                  }}
                />
              )}
            </>
          )}
          {(job.status === "failed" ||
            job.status === "canceled" ||
            job.status === "done") && (
            <>
              {!job.sourceDeleted && (
                <ActionButton
                  label="Encode again"
                  onClick={() =>
                    api(`/api/jobs/${job.id}/retry`, { method: "POST" })
                  }
                />
              )}
              <ActionButton
                label="Remove"
                danger
                onClick={() =>
                  api(`/api/jobs/${job.id}`, { method: "DELETE" })
                }
              />
            </>
          )}
        </div>
      </div>

      <div className="job-meta">
        {job.status === "running" && (
          <>
            <span className="job-pct">{Math.round((job.progress || 0) * 100)}%</span>
            {job.passes > 1 && (
              <span>
                pass {job.pass} of {job.passes}
              </span>
            )}
            {job.fps > 0 && <span>{job.fps.toFixed(0)} fps</span>}
            {job.speed > 0 && (
              <span>
                {job.speed.toFixed(2)}
                {"\u00d7"} realtime
              </span>
            )}
            {job.eta > 0 && <span>{formatDuration(job.eta)} left</span>}
            {projectedSize > 0 && (
              <span>heading for about {formatBytes(projectedSize)}</span>
            )}
            {job.sourceSize > 0 && projectedSize > 0 && (
              <SavingFact pct={projectedPct} projected />
            )}
          </>
        )}
        {job.status === "done" && (
          <>
            <span>
              {formatBytes(job.outSize)} from {formatBytes(job.sourceSize)}
            </span>
            {job.sourceSize > 0 && <SavingFact pct={job.savedPct} />}
            <span>
              took{" "}
              {formatDuration(
                (new Date(job.ended).getTime() - new Date(job.started).getTime()) / 1000,
              )}
            </span>
            {job.verified && (
              <span className="job-verified">checked: {job.verifyNote}</span>
            )}
            {!job.verified && job.verifyNote && <span>{job.verifyNote}</span>}
          </>
        )}
        {(job.status === "queued" || job.status === "failed" || job.status === "canceled") && (
          <>
            <span className="job-path">{baseName(job.source)}</span>
            {job.sourceSize > 0 && (
              <span>{formatBytes(job.sourceSize)}</span>
            )}
            {job.attempts > 1 && <span>attempt {job.attempts}</span>}
          </>
        )}
      </div>

      {job.status === "running" && <JobFfmpeg jobId={job.id} />}

      <div className="job-bar">
        <i style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
      </div>
      {job.error && <p className="job-error">{job.error}</p>}
    </article>
  );
}

// JobFfmpeg reports the process this job is encoding with. The server tags
// each running ffmpeg it reads out of the process table with the job that
// started it, so this is that job's own process and not another ffmpeg that
// happens to be running on the same machine.
function JobFfmpeg({ jobId }: { jobId: string }) {
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

function SavingFact({ pct, projected }: { pct: number; projected?: boolean }) {
  const rounded = Math.round(pct);
  if (rounded >= 0) {
    return (
      <span className="job-saving">
        {projected ? "about " : ""}
        {rounded}% smaller
      </span>
    );
  }
  return (
    <span className="job-saving negative">
      {projected ? "about " : ""}
      {Math.abs(rounded)}% bigger
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  danger,
  accent,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      className={`btn btn-small btn-quiet${danger ? " btn-danger" : ""}${accent ? " btn-accent" : ""}`}
      onClick={async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
          await onClick();
        } catch (err: unknown) {
          toast((err as Error).message);
          btn.disabled = false;
        }
      }}
    >
      {label}
    </button>
  );
}

function MoveButton({
  glyph,
  id,
  delta,
}: {
  glyph: string;
  id: string;
  delta: number;
}) {
  return (
    <button
      className="btn btn-small btn-quiet move-btn"
      title={delta === 0 ? "Move to the top" : delta < 0 ? "Move up" : "Move down"}
      onClick={() =>
        api(`/api/jobs/${id}/move`, {
          method: "POST",
          body: JSON.stringify({ delta }),
        })
      }
    >
      {glyph}
    </button>
  );
}
