import { useEffect, useState } from "react";
import { api } from "./api";
import type { FfmpegProcess, FfmpegUsage, SystemStatus } from "./types";

// How often the machine is re-read. Every part of the page that wants these
// numbers shares this one timer, and the CPU figures are deltas against the
// previous read, so the interval has to be steady rather than driven by
// whatever happens to be on screen.
export const POLL_MS = 3000;

// Two minutes of CPU readings per job, for the sparkline in the job row.
const HISTORY_SAMPLES = 40;
const HISTORY_JOBS = 24;

// cpuHistory is keyed by job id rather than by pid: a two-pass encode stops and
// starts ffmpeg between passes, and its curve should carry on across that.
const cpuHistory = new Map<string, number[]>();
const noHistory: number[] = [];

type Snapshot = { status: SystemStatus | null; error: string };
type Listener = (state: Snapshot) => void;

let state: Snapshot = { status: null, error: "" };
let timer: number | null = null;
const listeners = new Set<Listener>();

async function load() {
  try {
    const status = await api<SystemStatus>("/api/system");
    recordCpu(status.ffmpegUsage);
    state = { status, error: "" };
  } catch (err) {
    state = { ...state, error: (err as Error).message };
  }
  for (const listener of listeners) listener(state);
}

// recordCpu appends the CPU reading of every job-owned process to its history.
// Processes with no rate yet are skipped rather than recorded as zero, which
// would dip the curve at the start of each pass.
function recordCpu(usage: FfmpegUsage) {
  for (const proc of usage.processes) {
    if (!proc.jobId || !proc.sampled) continue;
    const history = cpuHistory.get(proc.jobId) ?? [];
    cpuHistory.delete(proc.jobId);
    cpuHistory.set(proc.jobId, [...history, proc.cpu].slice(-HISTORY_SAMPLES));
  }
  // Finished jobs are not dropped until their history ages out, so a long
  // session cannot pile these up but a job between passes keeps its curve.
  while (cpuHistory.size > HISTORY_JOBS) {
    const oldest = cpuHistory.keys().next();
    if (oldest.done) break;
    cpuHistory.delete(oldest.value);
  }
}

// useSystemStatus follows the machine while anything is watching it.
export function useSystemStatus(): Snapshot {
  const [current, setCurrent] = useState(state);

  useEffect(() => {
    listeners.add(setCurrent);
    if (listeners.size === 1) {
      void load();
      timer = window.setInterval(load, POLL_MS);
    }
    return () => {
      listeners.delete(setCurrent);
      if (listeners.size === 0 && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return current;
}

// useJobFfmpeg is the ffmpeg process a single job is encoding with, taken from
// the last report, along with the CPU readings that process has produced.
// Matching on the job id is what makes it that job's process and not another
// one running on the same machine.
export function useJobFfmpeg(jobId: string): Snapshot & {
  process: FfmpegProcess | null;
  cpu: number[];
} {
  const snapshot = useSystemStatus();
  const process = snapshot.status?.ffmpegUsage.processes.find((p) => p.jobId === jobId) ?? null;
  return { ...snapshot, process, cpu: cpuHistory.get(jobId) ?? noHistory };
}
