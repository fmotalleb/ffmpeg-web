import type { Job } from "./job";

export interface HwDevice {
  kind: string;
  name: string;
  path?: string;
  driver?: string;
}

export interface HwEncoderStatus {
  engine: string;
  label: string;
  vendor: string;
  available: boolean;
  reason?: string;
  codecs: string[];
  missing?: string[];
}

export interface FfmpegProcess {
  pid: number;
  kind: string;
  jobId?: string;
  sampled: boolean;
  cpu: number;
  rss: number;
  threads: number;
}

export interface FfmpegUsage {
  running: boolean;
  sampled: boolean;
  cpu: number;
  cpuOfHost: number;
  rss: number;
  processes: FfmpegProcess[];
}

export interface SystemStatus {
  hostname: string;
  os: string;
  arch: string;
  cpus: number;
  cpuModel?: string;
  load1: number;
  load5: number;
  load15: number;
  memTotal: number;
  memUsed: number;
  memPercent: number;
  devices: HwDevice[];
  encoders: HwEncoderStatus[];
  encoding: { jobs: number; fps: number };
  ffmpegUsage: FfmpegUsage;
  ffmpegVersion?: string;
}

export interface QueueSettings {
  verifyOutput: boolean;
  autoDeleteSource: boolean;
  shrinkThreshold: number;
  postQueue: Hook;
}

export interface Hook {
  type: string;
  command: string;
  url: string;
}

export interface Snapshot {
  version: number;
  savedAt: string;
  paused: boolean;
  settings: QueueSettings;
  jobs: Job[];
  order: string[];
}
