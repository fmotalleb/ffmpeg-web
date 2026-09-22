import { useEffect, useState } from "react";
import { api } from "./api";
import type { FfmpegProcess, SystemStatus } from "./types";

// How often the machine is re-read. Every part of the page that wants these
// numbers shares this one timer, and the CPU figures are deltas against the
// previous read, so the interval has to be steady rather than driven by
// whatever happens to be on screen.
const POLL_MS = 3000;

type Snapshot = { status: SystemStatus | null; error: string };
type Listener = (state: Snapshot) => void;

let state: Snapshot = { status: null, error: "" };
let timer: number | null = null;
const listeners = new Set<Listener>();

async function load() {
  try {
    state = { status: await api<SystemStatus>("/api/system"), error: "" };
  } catch (err) {
    state = { ...state, error: (err as Error).message };
  }
  for (const listener of listeners) listener(state);
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
// the last report. Matching on the job id is what makes it that job's process
// and not another one running on the same machine.
export function useJobFfmpeg(jobId: string): {
  status: SystemStatus | null;
  process: FfmpegProcess | null;
} {
  const { status } = useSystemStatus();
  const process = status?.ffmpegUsage.processes.find((p) => p.jobId === jobId) ?? null;
  return { status, process };
}
