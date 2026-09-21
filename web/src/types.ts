export interface Spec {
  input: string;
  outputName: string;
  container: string;
  webOptimize: boolean;
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
  bitrate: number;
  mixdown: string;
  sampleRate: number;
  gain: number;
  normalize: boolean;
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
  sharpen: boolean;
  deblock: boolean;
  rotate: number;
  flipH: boolean;
  grayscale: boolean;
}

export interface SubtitleSpec {
  mode: string;
  track: number;
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
  estimatedSize: number;
  sourceSize: number;
  savedPct: number;
  eta: number;
  duration: number;
  verified: boolean;
  verifyNote: string;
  sourceDeleted: boolean;
  attempts: number;
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
