export interface Spec {
  input: string;
  outputName: string;
  container: string;
  webOptimize: boolean;
  /** Replace the source file with the result once it is done and checked. */
  moveInPlace: boolean;
  /** ffmpeg verbosity for this run's log; empty means "error". */
  logLevel: string;
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
