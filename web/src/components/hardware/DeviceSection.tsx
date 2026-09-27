import type { SystemStatus } from "../../types";
import { Dot } from "./atoms";

export function DeviceSection({ status }: { status: SystemStatus | null }) {
  const devices = status?.devices ?? [];
  return (
    <section className="hw-section">
      <div className="hw-section-head">
        <span>Graphics devices</span>
        <span>{status ? devices.length : "\u2014"}</span>
      </div>
      {status && devices.length === 0 && (
        <p className="hw-note">
          No graphics device reported here &mdash; encodes will run on the CPU.
        </p>
      )}
      {devices.map((device) => (
        <div className="hw-item" key={device.path || device.name}>
          <Dot on />
          <div className="hw-item-body">
            <div>{device.name}</div>
            <div className="hw-item-detail">
              {[device.path, device.driver ? `driver ${device.driver}` : ""]
                .filter(Boolean)
                .join(" \u00b7 ")}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
