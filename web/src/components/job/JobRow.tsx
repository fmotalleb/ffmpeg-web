import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { api, toast } from "../../api";
import { baseName, formatBytes, formatDuration } from "../../utils";
import type { Job } from "../../types";
import { ActionButton, MoveButton } from "./JobButtons";
import { JobFfmpeg } from "./JobFfmpeg";
import { SavingFact } from "./SavingFact";

const STATUS_LABELS: Record<string, string> = {
  queued: "waiting",
  running: "encoding",
  done: "finished",
  failed: "failed",
  canceled: "cancelled",
};

// A running encode started at a fixed instant, so the elapsed time only means
// anything if it keeps moving: tick it once a second while the row is mounted.
function ElapsedTime({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const start = new Date(since).getTime();
  if (!start || isNaN(start)) return null;
  return <span>{(now - start) / 1000 > 0 ? formatDuration((now - start) / 1000) : "0:00"} elapsed</span>;
}

export function JobRow({ job }: { job: Job }) {
  const setActiveTab = useStore((s) => s.setActiveTab);
  const settings = useStore((s) => s.settings);
  const setProbe = useStore((s) => s.setProbe);
  const setLogView = useStore((s) => s.setLogView);
  const queueSettings = useStore((s) => s.queue.settings);
  const queuePaused = useStore((s) => s.queue.paused);

  // A running encode under a paused queue is frozen in place: its ffmpeg is
  // stopped, so say so instead of implying it is still making progress.
  const stateLabel =
    job.status === "running" && queuePaused
      ? "paused"
      : STATUS_LABELS[job.status] || job.status;

  const threshold = queueSettings?.shrinkThreshold || 20;

  const projectedSize =
    job.outSize > 0 && job.progress > 0.01
      ? Math.round(job.outSize / job.progress)
      : 0;
  const projectedPct =
    job.sourceSize > 0 && projectedSize > 0
      ? (1 - projectedSize / job.sourceSize) * 100
      : 0;

  const handleEdit = async () => {
    try {
      const info = await api<import("../../types").MediaInfo>("/api/probe", {
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
      className={`job ${job.status}${
        job.status === "running" && queuePaused ? " frozen" : ""
      }${job.sourceDeleted ? " deleted-source" : ""}`}
    >
      <div className="job-head">
        <span className="job-state">
          {job.status === "running" && queuePaused && "\u23f8 "}
          {stateLabel}
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
              {!job.sourceDeleted && (
                <ActionButton
                  label="Move in place"
                  onClick={async () => {
                    if (
                      !confirm(
                        `Replace the original file with the encoded result? ${job.source} — the original will be gone afterwards.`,
                      )
                    )
                      return;
                    await api(`/api/jobs/${job.id}/move-in-place`, {
                      method: "POST",
                    });
                    toast("Encoded file moved into place", true);
                  }}
                />
              )}
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
            {job.started && <ElapsedTime since={job.started} />}
            {projectedSize > 0 ? (
              <>
                {job.eta > 0 && <span>{formatDuration(job.eta)} left</span>}
                <span>heading for about {formatBytes(projectedSize)}</span>
              </>
            ) : (
              // No output size yet — ffmpeg has not reported enough progress
              // for the projection to mean anything, so say so plainly.
              <span className="job-calc">calculating the result approximate size…</span>
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

      {job.status !== "running" && job.ffmpegPid ? (
        // The run is over, which is exactly when its log matters most: a
        // failure is only explained by the lines leading up to it. The server
        // keeps the file for a day, so the button stays useful.
        <div className="job-ffmpeg">
          <span className="job-ffmpeg-label">ffmpeg</span>
          <span className="job-ffmpeg-value">pid {job.ffmpegPid}</span>
          <button
            className="btn btn-small btn-quiet job-log-btn"
            title="Read the log of this job's ffmpeg run"
            onClick={() => setLogView(job.ffmpegPid!, `pid ${job.ffmpegPid}`)}
          >
            Log
          </button>
          <span>the log is kept for a day</span>
        </div>
      ) : null}

      <div className="job-bar">
        <i style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
      </div>
      {job.error && <p className="job-error">{job.error}</p>}
    </article>
  );
}
