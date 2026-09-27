import { formatBytes } from "../../utils";
import type { SystemStatus } from "../../types";
import { Bar } from "./atoms";

export function MachineSection({ status }: { status: SystemStatus | null }) {
  if (!status) return null;
  const hasMemory = status.memTotal > 0;
  const hasLoad = status.load1 >= 0;

  return (
    <section className="hw-section">
      <div className="hw-section-head">
        <span>This machine</span>
        <span>{status.cpus} cores</span>
      </div>
      {status.cpuModel && <p className="hw-note">{status.cpuModel}</p>}

      {hasLoad && (
        <>
          <div className="hw-row">
            <span>Load</span>
            <span className="hw-value strong">
              {status.load1.toFixed(2)} / {status.load5.toFixed(2)} / {status.load15.toFixed(2)}
            </span>
          </div>
          <Bar pct={(status.load1 / Math.max(1, status.cpus)) * 100} />
        </>
      )}

      {hasMemory && (
        <>
          <div className="hw-row">
            <span>Memory</span>
            <span className="hw-value strong">
              {formatBytes(status.memUsed)} / {formatBytes(status.memTotal)}
            </span>
          </div>
          <Bar pct={status.memPercent} />
        </>
      )}

      {!hasLoad && !hasMemory && (
        <p className="hw-note">
          This platform does not report load or memory &mdash; only the encoders
          and devices above are known.
        </p>
      )}
    </section>
  );
}
