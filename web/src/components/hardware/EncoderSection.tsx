import type { SystemStatus } from "../../types";
import { Dot } from "./atoms";

export function EncoderSection({ status }: { status: SystemStatus | null }) {
  return (
    <section className="hw-section">
      <div className="hw-section-head">
        <span>Hardware encoders</span>
        <span>
          {status
            ? `${status.encoders.filter((e) => e.available).length}/${status.encoders.length} usable`
            : "\u2014"}
        </span>
      </div>
      {!status && <p className="hw-note">Checking what this ffmpeg build can use&hellip;</p>}
      {status?.encoders.map((encoder) => (
        <div
          className={`hw-item${encoder.available ? "" : " is-off"}`}
          key={encoder.engine}
        >
          <Dot on={encoder.available} />
          <div className="hw-item-body">
            <div>{encoder.label}</div>
            <div className="hw-item-detail">
              {encoder.available
                ? encoder.codecs.join(", ") || "no codecs"
                : encoder.reason || "unavailable"}
            </div>
            {encoder.available && encoder.missing && encoder.missing.length > 0 && (
              <div className="hw-item-why">
                this ffmpeg build has no {encoder.missing.join(", ")}
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
