import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useSystemStatus } from "../system";
import { baseName, formatBytes, formatDuration } from "../utils";
import type { FfmpegProcess, FfmpegUsage, Job, SystemStatus } from "../types";

// The chip has room for a word, not for "Intel Quick Sync (hardware)".
const SHORT_NAME: Record<string, string> = {
  nvenc: "NVENC",
  qsv: "Quick Sync",
  vaapi: "VAAPI",
  videotoolbox: "VideoToolbox",
  amf: "AMF",
};

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
        title="What this machine has and what it is being asked to do"
      >
        <span className={`hw-dot ${dot}`} />
        <span className="hw-chip-label">Hardware</span>
        <span className="hw-chip-value">{value}</span>
      </button>

      {open && (
        <div className="hw-panel" role="dialog" aria-label="Hardware status">
          <FfmpegSection usage={status?.ffmpegUsage} jobs={running} cpus={status?.cpus ?? 1} />
          <EncoderSection status={status} />
          <DeviceSection status={status} />
          <MachineSection status={status} />
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
        </div>
      )}
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const level = clamped >= 85 ? " is-critical" : clamped >= 60 ? " is-hot" : "";
  return (
    <div className={`hw-bar${level}`}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

function Dot({ on }: { on: boolean }) {
  return <span className={`hw-dot ${on ? "on" : "off"}`} />;
}

// The live half of the report: what ffmpeg is doing, straight from the process
// counters, next to what the queue itself says each job is achieving. Each job
// is shown against the process it is actually encoding with, so a second
// ffmpeg running on the machine cannot be mistaken for the queue's work.
function FfmpegSection({
  usage,
  jobs,
  cpus,
}: {
  usage?: FfmpegUsage;
  jobs: Job[];
  cpus: number;
}) {
  const idle = !usage?.running && jobs.length === 0;
  const threads = usage?.processes.reduce((acc, p) => acc + p.threads, 0) ?? 0;
  const forJob = (id: string) => usage?.processes.find((p) => p.jobId === id) ?? null;

  return (
    <section className="hw-section">
      <div className="hw-section-head">
        <span>ffmpeg</span>
        <span>
          {usage?.running
            ? `${usage.processes.length} process${usage.processes.length === 1 ? "" : "es"}`
            : "idle"}
        </span>
      </div>

      {idle ? (
        <p className="hw-note">Nothing is encoding right now.</p>
      ) : (
        <>
          <div className="hw-row">
            <span>CPU</span>
            <span className="hw-value strong">
              {usage?.sampled
                ? `${Math.round(usage.cpuOfHost)}% of the machine`
                : "measuring\u2026"}
            </span>
          </div>
          {usage?.sampled && <Bar pct={usage.cpuOfHost} />}
          {usage?.sampled && (
            <div className="hw-row">
              <span>Of a single core</span>
              <span className="hw-value">{Math.round(usage.cpu)}%</span>
            </div>
          )}
          {usage?.running && (
            <>
              <div className="hw-row">
                <span>Memory</span>
                <span className="hw-value">{formatBytes(usage.rss)}</span>
              </div>
              <div className="hw-row">
                <span>Threads</span>
                <span className="hw-value">{threads}</span>
              </div>
            </>
          )}
          {jobs.map((job) => (
            <div className="hw-job" key={job.id}>
              <div className="hw-row">
                <span title={job.label || job.source}>
                  {baseName(job.label || job.source)}
                </span>
                <span className="hw-value strong">
                  {[
                    `${Math.round(job.progress * 100)}%`,
                    job.fps > 0 ? `${Math.round(job.fps)} fps` : "",
                    job.speed > 0 ? `${job.speed.toFixed(2)}\u00d7` : "",
                    job.eta > 0 ? `${formatDuration(job.eta)} left` : "",
                  ]
                    .filter(Boolean)
                    .join(" \u00b7 ")}
                </span>
              </div>
              <ProcessFacts proc={forJob(job.id)} cpus={cpus} />
            </div>
          ))}
        </>
      )}
    </section>
  );
}

// ProcessFacts describes one ffmpeg process: its pid, what it costs and how
// wide it runs. Everything shown here is read off that pid.
function ProcessFacts({ proc, cpus }: { proc: FfmpegProcess | null; cpus: number }) {
  if (!proc) {
    return (
      <div className="hw-row hw-sub">
        <span>process</span>
        <span className="hw-value">starting&hellip;</span>
      </div>
    );
  }
  return (
    <div className="hw-row hw-sub">
      <span>ffmpeg pid {proc.pid}</span>
      <span className="hw-value">
        {[
          proc.sampled ? `CPU ${Math.round(proc.cpu)}%` : "measuring cpu\u2026",
          cpus > 1 && proc.sampled ? `${(proc.cpu / cpus).toFixed(1)}% of this machine` : "",
          formatBytes(proc.rss),
          `${proc.threads} threads`,
        ]
          .filter(Boolean)
          .join(" \u00b7 ")}
      </span>
    </div>
  );
}

function EncoderSection({ status }: { status: SystemStatus | null }) {
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

function DeviceSection({ status }: { status: SystemStatus | null }) {
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

function MachineSection({ status }: { status: SystemStatus | null }) {
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
