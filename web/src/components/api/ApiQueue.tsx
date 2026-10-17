import { useEffect, useRef } from "react";
import { useApiMonitor } from "../../store/apiMonitor";
import type { ApiCall } from "../../store/apiMonitor";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ApiCallRow({ call }: { call: ApiCall }) {
  const isError = call.status === "error";
  const isSuccess = call.status === "success";

  return (
    <div className={`api-call-row ${isError ? "error" : isSuccess ? "success" : "running"}`}>
      <span className="api-method">{call.method}</span>
      <span className="api-path" title={call.path}>
        {call.path}
      </span>
      <span className="api-duration">
        {call.duration != null ? formatDuration(call.duration) : "…"}
      </span>
      {isError && call.error && (
        <span className="api-error" title={call.error}>
          {call.error}
        </span>
      )}
    </div>
  );
}

// The call list lives in the top bar as a chip beside the hardware monitor:
// a glanceable count on the chip, the full list in a panel that drops down
// from it. The store's `collapsed` flag is the panel's open/closed state.
export function ApiQueue() {
  const activeCalls = useApiMonitor((state) => state.activeCalls);
  const completedCalls = useApiMonitor((state) => state.completedCalls);
  const collapsed = useApiMonitor((state) => state.collapsed);
  const setCollapsed = useApiMonitor((state) => state.setCollapsed);
  const clearAll = useApiMonitor((state) => state.clearAll);
  const rootRef = useRef<HTMLDivElement>(null);

  const open = !collapsed;

  // Like the monitor beside it: Escape puts the panel away, and so does a
  // click anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollapsed(true);
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setCollapsed(true);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, setCollapsed]);

  const done = completedCalls.filter((c) => c.status === "success").length;
  const errors = completedCalls.length - done;
  const empty = activeCalls.length === 0 && completedCalls.length === 0;

  return (
    <div className="api-anchor" ref={rootRef}>
      <button
        className={`hw-chip api-chip${open ? " is-open" : ""}`}
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={open}
        aria-controls="api-queue-panel"
        title="API calls — every request this page has made, running and finished"
      >
        <span className="hw-chip-label">API</span>
        <span className="api-chip-counts">
          <span className="running" title="Requests in flight">
            {activeCalls.length} run
          </span>
          <span className="done" title="Requests that finished successfully">
            {done} ok
          </span>
          <span className="error" title="Requests that failed">
            {errors} err
          </span>
        </span>
      </button>

      {open && (
        <div className="api-queue" id="api-queue-panel" role="dialog" aria-label="API calls">
          <div className="api-queue-header">
            <span className="api-queue-title">API Calls</span>
            <div className="api-queue-badges">
              <span className="api-badge running" title="Requests in flight">
                {activeCalls.length} running
              </span>
              <span className="api-badge done" title="Requests that finished successfully">
                {done} done
              </span>
              <span className="api-badge error" title="Requests that failed">
                {errors} err
              </span>
            </div>
            <button
              className="api-queue-clear"
              onClick={clearAll}
              title="Clear every call from the list"
            >
              Clear
            </button>
          </div>
          {empty ? (
            <p className="api-queue-empty">No API calls recorded yet.</p>
          ) : (
            <>
              {activeCalls.length > 0 && (
                <div className="api-queue-section">
                  <span className="api-queue-section-title">Running ({activeCalls.length})</span>
                  {activeCalls.map((call) => (
                    <ApiCallRow key={call.id} call={call} />
                  ))}
                </div>
              )}
              {completedCalls.length > 0 && (
                <div className="api-queue-section">
                  <span className="api-queue-section-title">Recent ({completedCalls.length})</span>
                  {completedCalls.map((call) => (
                    <ApiCallRow key={call.id} call={call} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
