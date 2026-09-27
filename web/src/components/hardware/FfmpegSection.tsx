import { useStore } from "../../store";
import { api, toast } from "../../api";
import { formatBytes, formatDuration } from "../../utils";
import type { FfmpegProcess, FfmpegUsage, Job } from "../../types";
import { Bar } from "./atoms";

// The live half of the report: what ffmpeg is doing, straight from the process
// counters, next to what the queue itself says each job is achieving. Every
// process is listed on its own, so a second ffmpeg running on the machine can
// be told apart from the queue's own work and stopped on its own.
export function FfmpegSection({
  usage,
  jobs,
  cpus,
}: {
  usage?: FfmpegUsage;
  jobs: Job[];
  cpus: number;
}) {
  const processes = usage?.processes ?? [];
  const running = processes.length > 0;
  const threads = processes.reduce((acc, p) => acc + p.threads, 0);
  const jobFor = (id?: string) => (id ? jobs.find((j) => j.id === id) ?? null : null);

  const killAll = async () => {
    if (
      !confirm(
        "Kill every ffmpeg process on this machine?\n\nAny encode in progress will fail.",
      )
    )
      return;
    try {
      const res = await api<{ killed: number }>("/api/ffmpeg/kill-all", { method: "POST" });
      toast(`Stopped ${res.killed} ffmpeg process${res.killed === 1 ? "" : "es"}`, true);
    } catch (err: unknown) {
      toast((err as Error).message);
    }
  };

  return (
    <section className="hw-section">
      <div className="hw-section-head">
        <span>ffmpeg</span>
        <span className="hw-section-tools">
          {running
            ? `${processes.length} process${processes.length === 1 ? "" : "es"}`
            : "idle"}
          {running && (
            <button
              className="btn btn-small btn-quiet hw-kill-all"
              title="Stop every ffmpeg process on this machine"
              onClick={killAll}
            >
              Kill all
            </button>
          )}
        </span>
      </div>

      {!running ? (
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
          <div className="hw-row">
            <span>Memory</span>
            <span className="hw-value">{formatBytes(usage?.rss ?? 0)}</span>
          </div>
          <div className="hw-row">
            <span>Threads</span>
            <span className="hw-value">{threads}</span>
          </div>
          {processes.map((proc) => (
            <ProcessRow key={proc.pid} proc={proc} cpus={cpus} job={jobFor(proc.jobId)} />
          ))}
        </>
      )}
    </section>
  );
}

// ProcessRow is one ffmpeg or ffprobe process: what it is encoding, if anything,
// then that process's own pid, CPU and memory. Details opens the process
// viewer, Log tails its own log file.
function ProcessRow({ proc, cpus, job }: { proc: FfmpegProcess; cpus: number; job: Job | null }) {
  const setProcessViewPid = useStore((s) => s.setProcessViewPid);
  const setLogView = useStore((s) => s.setLogView);

  const progress = job
    ? [
        `${Math.round(job.progress * 100)}%`,
        job.fps > 0 ? `${Math.round(job.fps)} fps` : "",
        job.speed > 0 ? `${job.speed.toFixed(2)}\u00d7` : "",
        job.eta > 0 ? `${formatDuration(job.eta)} left` : "",
      ]
        .filter(Boolean)
        .join(" \u00b7 ")
    : `pid ${proc.pid}`;

  return (
    <div className="hw-job">
      <div className="hw-row">
        <span className="hw-value strong">{progress}</span>
      </div>
      <div className="hw-row hw-sub">
        <span className="hw-pid">
          {proc.kind} pid {proc.pid}
          <button
            className="btn btn-small btn-quiet hw-log-btn"
            title="Tail this process's log"
            onClick={() => setLogView(proc.pid, `pid ${proc.pid}`)}
          >
            Log
          </button>
          <button
            className="btn btn-small btn-quiet hw-log-btn"
            title="Show this process's details"
            onClick={() => setProcessViewPid(proc.pid)}
          >
            Details
          </button>
        </span>
        <span className="hw-value">
          {[
            proc.sampled ? `CPU ${Math.round(proc.cpu)}%` : "measuring cpu\u2026",
            cpus > 1 && proc.sampled ? `${(proc.cpu / cpus).toFixed(1)}% of this machine` : "",
            `RAM ${formatBytes(proc.rss)}`,
            `${proc.threads} threads`,
          ]
            .filter(Boolean)
            .join(" \u00b7 ")}
        </span>
      </div>
    </div>
  );
}
