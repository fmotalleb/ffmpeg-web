import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { api } from "../../api";

const REFRESH_MS = 1000;

// FfmpegLogViewer tails one ffmpeg run's log, identified by the pid shown in
// the queue and the hardware popover. While it is open it re-fetches every
// second so a running encode streams into it; Refresh forces a fetch, Pause
// stops the timer without closing the view.
export function FfmpegLogViewer() {
  const pid = useStore((s) => s.logViewPid);
  const title = useStore((s) => s.logViewTitle);
  const setLogView = useStore((s) => s.setLogView);

  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);
  const followRef = useRef(true);
  const preRef = useRef<HTMLPreElement>(null);

  const fetchLog = useCallback(async () => {
    if (pid == null) return;
    setLoading(true);
    try {
      const data = await api<{ pid: number; lines: string[] }>(
        `/api/ffmpeg/${pid}/log?lines=600`,
      );
      setLines(data.lines ?? []);
      setError("");
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  // First load + the one-second pulse while open and not paused.
  useEffect(() => {
    if (pid == null) return;
    followRef.current = true;
    setLines([]);
    setError("");
    setAuto(true);
    fetchLog();
    if (!auto) return;
    const timer = setInterval(fetchLog, REFRESH_MS);
    return () => clearInterval(timer);
  }, [pid, auto, fetchLog]);

  // Follow the tail like a terminal, unless the user scrolled up to read.
  useEffect(() => {
    const pre = preRef.current;
    if (pre && followRef.current) pre.scrollTop = pre.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const pre = preRef.current;
    if (!pre) return;
    followRef.current = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  };

  const open = pid != null;
  if (!open) return null;

  const status = error
    ? error
    : lines.length
      ? `${lines.length} line${lines.length === 1 ? "" : "s"}${auto ? " · refreshing every second" : " · paused"}`
      : loading
        ? "reading…"
        : "no output yet";

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) setLogView(null);
      }}
    >
      <div className="modal-card log-modal" role="dialog" aria-modal="true" aria-labelledby="log-title">
        <header className="modal-head">
          <h2 id="log-title">
            ffmpeg log <span className="log-pid">{title || `pid ${pid}`}</span>
          </h2>
          <div className="log-tools">
            <button
              className={`btn btn-small${auto ? "" : " btn-primary"}`}
              onClick={() => setAuto(!auto)}
              title={auto ? "Stop the automatic refresh" : "Refresh every second again"}
            >
              {auto ? "Pause auto-refresh" : "Resume auto-refresh"}
            </button>
            <button className="btn btn-small" onClick={fetchLog} disabled={loading}>
              Refresh
            </button>
            <button className="btn btn-small btn-quiet" onClick={() => setLogView(null)}>
              Close
            </button>
          </div>
        </header>
        <pre className="log-view" ref={preRef} onScroll={onScroll}>
          {error ? (
            <span className="log-error">{error}</span>
          ) : lines.length ? (
            lines.join("\n")
          ) : (
            <span className="log-empty">Nothing from this process yet…</span>
          )}
        </pre>
        <footer className="log-foot">
          <span>{status}</span>
          <span className="log-follow">{followRef.current ? "following tail" : "scrolled up"}</span>
        </footer>
      </div>
    </div>
  );
}
