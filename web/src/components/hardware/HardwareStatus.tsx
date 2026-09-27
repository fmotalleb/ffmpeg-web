import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { useSystemStatus } from "../../system";
import { SHORT_NAME } from "./atoms";
import { FfmpegSection } from "./FfmpegSection";
import { EncoderSection } from "./EncoderSection";
import { DeviceSection } from "./DeviceSection";
import { MachineSection } from "./MachineSection";

export function HardwareStatus() {
  const jobs = useStore((s) => s.jobs);
  const [open, setOpen] = useState(false);
  const { status, error } = useSystemStatus();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const running = Array.from(jobs.values()).filter((j) => j.status === "running");
  const accelerators = status ? status.encoders.filter((e) => e.available) : [];
  const busy = (status?.ffmpegUsage.running ?? false) || running.length > 0;

  // One glance at the top bar: is anything encoding, and would it be on the GPU?
  const dot = error ? "off" : busy ? "hot" : accelerators.length ? "on" : "off";
  const value = error
    ? "not reported"
    : accelerators.length
      ? accelerators.map((e) => SHORT_NAME[e.engine] ?? e.label).join(" · ")
      : "CPU only";

  return (
    <div className="hw">
      <button
        className={`hw-chip${open ? " is-open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="System monitor — what this machine has and what the encodes are doing to it right now"
      >
        <span className={`hw-dot ${dot}`} />
        <span className="hw-chip-label">Hardware</span>
        <span className="hw-chip-value">{value}</span>
        <span className="hw-chip-kind">monitor</span>
      </button>

      {open && (
        <div className="hw-panel" role="dialog" aria-label="Hardware monitor">
          <FfmpegSection usage={status?.ffmpegUsage} jobs={running} cpus={status?.cpus ?? 1} />
          <MachineSection status={status} />
          <DeviceSection status={status} />
          {status && (
            <p className="hw-foot">
              {[
                status.hostname,
                `${status.os}/${status.arch}`,
                status.ffmpegVersion ? `ffmpeg ${status.ffmpegVersion}` : "ffmpeg version unknown",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <EncoderSection status={status} />
        </div>
      )}
    </div>
  );
}
