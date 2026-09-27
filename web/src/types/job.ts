import type { Spec } from "./spec";

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface Job {
  id: string;
  batchId?: string;
  label: string;
  spec: Spec;
  source: string;
  output: string;
  status: JobStatus;
  progress: number;
  pass: number;
  passes: number;
  fps: number;
  speed: number;
  bitrate: string;
  frame: number;
  outSize: number;
  sourceSize: number;
  savedPct: number;
  eta: number;
  duration: number;
  verified: boolean;
  verifyNote: string;
  sourceDeleted: boolean;
  attempts: number;
  /** The ffmpeg process of the last run, so its log stays reachable. */
  ffmpegPid?: number;
  error: string;
  queued: string;
  started: string;
  ended: string;
}

export interface EncoderLibrary {
  id: string;
  codec: string;
  name: string;
  ffmpeg: string;
  kind: "cpu" | "gpu";
  vendor?: string;
  note: string;
  qualityMax: number;
  qualityGood: number;
  qualityInverted?: boolean;
  supportsSpeed: boolean;
  supportsTune: boolean;
  supportsLevel: boolean;
  supportsTwoPass: boolean;
  available: boolean;
  unavailableReason?: string;
}

export interface EncoderKind {
  id: "cpu" | "gpu";
  label: string;
  blurb: string;
}

export interface EncoderCatalog {
  kinds: EncoderKind[];
  libraries: EncoderLibrary[];
}
