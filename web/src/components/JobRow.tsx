import { useStore } from "../store";
import { api, toast } from "../api";
import { baseName, formatBytes, formatDuration } from "../utils";
import type { Job } from "../types";

export function JobRow({ job }: { job: Job }) {
  const setActiveTab = useStore((s) => s.setActiveTab);
  const settings = useStore((s) => s.settings);
  const setProbe = useStore((s) => s.setProbe);
  const queueSettings = useStore((s) => s.queue.settings);

  const threshold = queueSettings?.shrinkThreshold || 20;

  const handlePreview = async () => {
    useStore.setState({ previewJobId: job.id });
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
      <div className="job-title">{job.label || baseName(job.output)}</div>
      <div className="job-sub job-meta">
        <span className="job-state">
          {
            ({
              queued: "waiting",
              running: "encoding",
              done: "finished",
              failed: "failed",
              canceled: "cancelled",
            } as Record<string, string>)[job.status] || job.status
          }
        </span>
        {job.status === "running" && (
          <>
            <span>{Math.round((job.progress || 0) * 100)}%</span>
            {job.passes > 1 && (
              <span>
                pass {job.pass} of {job.passes}
              </span>
            )}
            {job.fps > 0 && <span>{job.fps.toFixed(0)} fps</span>}
            {job.speed > 0 && <span>{job.speed.toFixed(2)}\u00d7 realtime</span>}
            {job.eta > 0 && <span>{formatDuration(job.eta)} left</span>}
            {job.estimatedSize > 0 && (
              <span>heading for about {formatBytes(job.estimatedSize)}</span>
            )}
            {job.sourceSize > 0 && job.estimatedSize > 0 && (
              <SavingFact pct={job.savedPct} projected />
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
              <span className="job-verified">
                checked: {job.verifyNote}
              </span>
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
      <div className="job-actions">
        {job.status === "queued" && (
          <>
            <MoveButton glyph={"\u2191"} id={job.id} delta={-1} />
            <MoveButton glyph={"\u2193"} id={job.id} delta={1} />
            <MoveButton glyph={"\u2912"} id={job.id} delta={0} />
          </>
        )}
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
              onClick={() =>
                api(`/api/jobs/${job.id}`, { method: "DELETE" })
              }
            />
          </>
        )}
      </div>
      <div className="job-bar">
        <i style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
        {job.status === "running" && job.estimatedSize > 0 && (
          <span className="job-bar-label">
            {"\u2248"} {formatBytes(job.estimatedSize)}
          </span>
        )}
      </div>
      {job.error && <p className="job-error">{job.error}</p>}
    </article>
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
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="btn btn-small btn-quiet"
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
