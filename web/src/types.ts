export interface Spec {
  input: string;
  outputName: string;
  container: string;
  webOptimize: boolean;
  /** Replace the source file with the result once it is done and checked. */
  moveInPlace: boolean;
  video: VideoSpec;
  audio: AudioSpec;
  picture: PictureSpec;
  filters: FilterSpec;
  subtitle: SubtitleSpec;
  trim: TrimSpec;
  extra: ExtraSpec;
}

export interface VideoSpec {
  encoder: string;
  library: string;
  rateMode: string;
  quality: number;
  bitrate: number;
  twoPass: boolean;
  speed: string;
  profile: string;
  level: string;
  tune: string;
  fpsMode: string;
  fps: string;
  gop: number;
}

export interface AudioSpec {
  encoder: string;
  track: number;
  /** Source audio streams to keep. Absent means "just track". */
  tracks?: number[];
  /** Extra audio files muxed in beside the source. */
  extra?: AddedTrack[];
  bitrate: number;
  mixdown: string;
  sampleRate: number;
  gain: number;
  normalize: boolean;
}

/** An extra audio or subtitle file chosen from the source folder or uploaded. */
export interface AddedTrack {
  path: string;
  language?: string;
  title?: string;
}

export interface PictureSpec {
  scaleMode: string;
  width: number;
  height: number;
  keepAspect: boolean;
  pad: boolean;
  cropTop: number;
  cropBottom: number;
  cropLeft: number;
  cropRight: number;
  cropDetect: boolean;
  pixelFormat: string;
}

export interface FilterSpec {
  deinterlace: string;
  denoise: string;
  deband: string;
  blur: string;
  sharpen: boolean;
  deblock: boolean;
  tonemap: boolean;
  color: ColorSpec;
  rotate: number;
  flipH: boolean;
  grayscale: boolean;
}

/** Picture adjustments. 0 always means "leave this alone". */
export interface ColorSpec {
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  hue: number;
}

export interface SubtitleSpec {
  mode: string;
  track: number;
  /** Source subtitle streams to keep, for the copy mode. Absent means "just track". */
  tracks?: number[];
  /** Extra subtitle files muxed in beside the source. */
  extra?: AddedTrack[];
}

export interface TrimSpec {
  enabled: boolean;
  start: number;
  end: number;
}

export interface ExtraSpec {
  encoderOptions: string;
  inputArgs: string;
  outputArgs: string;
}

export interface MediaInfo {
  path: string;
  name: string;
  size: number;
  duration: number;
  container: string;
  bitrate: number;
  video: VideoTrack | null;
  audio: Track[];
  subtitles: Track[];
}

export interface VideoTrack {
  codec: string;
  width: number;
  height: number;
  fps: number;
  pixelFormat: string;
  interlaced: boolean;
}

export interface Track {
  index: number;
  codec: string;
  language: string;
  title: string;
  channels: number;
  default: boolean;
}

export interface Preset {
  id: string;
  name: string;
  group: string;
  note: string;
  owned: boolean;
  settings: Spec;
}

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

export interface BrowseEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export interface BrowseResponse {
  path: string;
  parent: string;
  entries: BrowseEntry[];
}

export interface ScanResponse {
  path: string;
  count: number;
  totalSize: number;
  files: { path: string; rel: string; size: number }[];
}

export interface PreviewCommand {
  bin: string;
  args: string[];
}
