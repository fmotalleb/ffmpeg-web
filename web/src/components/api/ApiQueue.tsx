import { useApiMonitor } from "../../store/apiMonitor";
import type { ApiCall } from "../../store/apiMonitor";
import { Icon } from "../icons";

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

export function ApiQueue() {
  const activeCalls = useApiMonitor((state) => state.activeCalls);
  const completedCalls = useApiMonitor((state) => state.completedCalls);
  const collapsed = useApiMonitor((state) => state.collapsed);
  const setCollapsed = useApiMonitor((state) => state.setCollapsed);
  const clearAll = useApiMonitor((state) => state.clearAll);

  if (activeCalls.length === 0 && completedCalls.length === 0) {
    return null;
  }

  const done = completedCalls.filter((c) => c.status === "success").length;
  const errors = completedCalls.length - done;

  return (
    <div className={`api-queue${collapsed ? " collapsed" : ""}`}>
      <div className="api-queue-header">
        <button
          className="api-queue-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          title={collapsed ? "Show the API call list" : "Hide the API call list"}
        >
          <span className={`api-queue-chevron${collapsed ? " is-collapsed" : ""}`}>
            <Icon name="chevron" />
          </span>
          <span className="api-queue-title">API Calls</span>
        </button>
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
      {!collapsed && (
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
  );
}
