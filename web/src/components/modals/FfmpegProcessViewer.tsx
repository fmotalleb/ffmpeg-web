import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { useSystemStatus } from "../../system";
import { api, toast } from "../../api";
import { baseName, formatBytes, formatDuration } from "../../utils";
import type { PreviewCommand } from "../../types";

// FfmpegProcessViewer is the details view of one ffmpeg process: everything the
// hardware report knows about that pid, refreshed by the same poll as the
// monitor. Stopping an encode mid-run fails its job, so Kill asks for a second,
// explicit confirmation rather than acting on one click.
export function FfmpegProcessViewer() {
  const pid = useStore((s) => s.processViewPid);
  const setProcessViewPid = useStore((s) => s.setProcessViewPid);
  const jobs = useStore((s) => s.jobs);
  const { status, error } = useSystemStatus();
  const [confirming, setConfirming] = useState(false);
  const [killing, setKilling] = useState(false);
  const [command, setCommand] = useState<PreviewCommand | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // The process is looked up above the early return: hooks run in the same order
  // every render, and the command has to load before anything is drawn.
  const proc =
    pid == null ? null : status?.ffmpegUsage.processes.find((p) => p.pid === pid) ?? null;
  const jobId = proc?.jobId ?? null;
  const job = jobId ? jobs.get(jobId) ?? null : null;
  const pass = job?.pass ?? 0;

  // The server rebuilds the command from the job, so this is the line ffmpeg is
  // running right now — temp target, pass log and pass number included. A
  // two-pass run is re-read when it moves on to its second pass.
  useEffect(() => {
    if (jobId == null) {
      setCommand(null);
      setCommandError(null);
      return;
    }
    let live = true;
    api<PreviewCommand>(`/api/jobs/${encodeURIComponent(jobId)}/command`)
      .then((cmd) => {
        if (!live) return;
        setCommand(cmd);
        setCommandError(null);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setCommand(null);
        setCommandError((err as Error).message);
      });
    return () => {
      live = false;
    };
  }, [jobId, pass]);

  const close = useCallback(() => {
    setConfirming(false);
    setKilling(false);
    setProcessViewPid(null);
  }, [setProcessViewPid]);

  useEffect(() => {
    if (pid == null) return;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [pid, close]);

  if (pid == null) return null;

  const kill = async () => {
    setKilling(true);
    try {
      await api(`/api/ffmpeg/${pid}/kill`, { method: "POST" });
      toast(`Stopped pid ${pid}`, true);
      close();
    } catch (err: unknown) {
      toast((err as Error).message);
    } finally {
      setKilling(false);
    }
  };

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={dialogRef} tabIndex={-1} className="modal-card process-modal" role="dialog" aria-modal="true" aria-labelledby="process-title">
        <header className="modal-head">
          <h2 id="process-title">
            Process <span className="log-pid">pid {pid}</span>
          </h2>
          <div className="modal-head-actions">
            <button className="btn btn-small btn-quiet" onClick={close}>
              Close
            </button>
          </div>
        </header>
        <div className="modal-body">
          {error && <p className="note">{error}</p>}
          {!proc && !error && (
            <p className="note">This process has already stopped.</p>
          )}
          {proc && (
            <div className="proc-facts">
              <div className="hw-row">
                <span>Process</span>
                <span className="hw-value strong">
                  {proc.kind} pid {proc.pid}
                </span>
              </div>
              <div className="hw-row">
                <span>Job</span>
                <span className="hw-value">
                  {job ? job.label || baseName(job.source) : "not a queued job"}
                </span>
              </div>
              <div className="hw-row">
                <span>CPU</span>
                <span className="hw-value strong">
                  {proc.sampled ? `${Math.round(proc.cpu)}% of a core` : "measuring\u2026"}
                </span>
              </div>
              <div className="hw-row">
                <span>Memory</span>
                <span className="hw-value strong">{formatBytes(proc.rss)}</span>
              </div>
              <div className="hw-row">
                <span>Threads</span>
                <span className="hw-value">{proc.threads}</span>
              </div>
              {job && (
                <>
                  <div className="hw-row">
                    <span>Progress</span>
                    <span className="hw-value">{Math.round(job.progress * 100)}%</span>
                  </div>
                  <div className="hw-row">
                    <span>Speed</span>
                    <span className="hw-value">
                      {[
                        job.fps > 0 ? `${Math.round(job.fps)} fps` : "",
                        job.speed > 0 ? `${job.speed.toFixed(2)}\u00d7` : "",
                        job.eta > 0 ? `${formatDuration(job.eta)} left` : "",
                      ]
                        .filter(Boolean)
                        .join(" \u00b7 ") || "\u2014"}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {jobId && (
            <div className="proc-command">
              <h3 className="group-title">
                Command that is running
                {job && job.passes === 2 ? ` \u2014 pass ${job.pass} of ${job.passes}` : ""}
              </h3>
              {commandError && <p className="note">{commandError}</p>}
              {!commandError && !command && <p className="note">Loading the command\u2026</p>}
              {!commandError && command && (
                <pre className="cmd-preview">
                  <b>{command.bin}</b>{" "}
                  {command.args
                    .map((a) => (/\s/.test(a) ? `"${a}"` : a))
                    .join(" ")}
                </pre>
              )}
            </div>
          )}

          {proc &&
            (confirming ? (
              <div className="proc-confirm">
                <p className="note">
                  Kill pid {pid}? An encode in progress will fail, and a stopped
                  process cannot be resumed.
                </p>
                <div className="proc-confirm-actions">
                  <button
                    className="btn btn-small btn-danger"
                    onClick={kill}
                    disabled={killing}
                  >
                    {killing ? "Killing\u2026" : `Yes, kill pid ${pid}`}
                  </button>
                  <button
                    className="btn btn-small btn-quiet"
                    onClick={() => setConfirming(false)}
                    disabled={killing}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn-small btn-danger proc-kill"
                onClick={() => setConfirming(true)}
              >
                Kill this process
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
