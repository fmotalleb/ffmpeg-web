import { useStore } from "../../store";
import { baseName, formatBytes, formatDuration } from "../../utils";
import type { FfmpegProcess, FfmpegUsage, Job } from "../../types";
import { Bar } from "./atoms";

// The live half of the report: what ffmpeg is doing, straight from the process
// counters, next to what the queue itself says each job is achieving. Each job
// is shown against the process it is actually encoding with, so a second
// ffmpeg running on the machine cannot be mistaken for the queue's work.
export function FfmpegSection({
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
  const openLog = () =>
    useStore.getState().setLogView(proc!.pid, `pid ${proc!.pid}`);
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
      <span className="hw-pid">
        ffmpeg pid {proc.pid}
        <button
          className="btn btn-small btn-quiet hw-log-btn"
          title="Tail this ffmpeg process's log"
          onClick={openLog}
        >
          Log
        </button>
      </span>
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
