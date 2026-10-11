import type { Spec } from "./spec";

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
