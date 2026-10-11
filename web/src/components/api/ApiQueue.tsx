import { useApiMonitor } from "../../store/apiMonitor";
import type { ApiCall } from "../../store/apiMonitor";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ApiCallRow({ call }: { call: ApiCall }) {
  // Status should always be set: "running", "success", or "error"
  // Default to "running" if somehow missing (shouldn't happen)
  const status = call.status ?? "running";
  const isError = status === "error";
  const isSuccess = status === "success";

  return (
    <div className={`api-call-row ${isError ? "error" : isSuccess ? "success" : "running"}`}>
      <span className="api-method">{call.method}</span>
      <span className="api-path" title={call.path}>
        {call.path}
      </span>
      <span className="api-duration">
        {call.duration ? formatDuration(call.duration) : "…"}
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
  const clearCompleted = useApiMonitor((state) => state.clearCompleted);

  if (activeCalls.length === 0 && completedCalls.length === 0) {
    return null;
  }

  return (
    <div className="api-queue">
      <div className="api-queue-header">
        <span className="api-queue-title">API Calls</span>
        <button
          className="api-queue-clear"
          onClick={clearCompleted}
          title="Clear completed calls"
        >
          Clear
        </button>
      </div>
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
    </div>
  );
}
