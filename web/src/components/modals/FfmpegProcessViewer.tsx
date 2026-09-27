import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { useSystemStatus } from "../../system";
import { api, toast } from "../../api";
import { baseName, formatBytes, formatDuration } from "../../utils";

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

  const dialogRef = useRef<HTMLDivElement>(null);

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

  const proc = status?.ffmpegUsage.processes.find((p) => p.pid === pid) ?? null;
  const job = proc?.jobId ? jobs.get(proc.jobId) ?? null : null;

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
