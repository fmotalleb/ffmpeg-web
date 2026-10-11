import type { Hook, QueueSettings, Spec } from "../types";

export function defaultSettings(): Spec {
  return {
    input: "",
    outputName: "",
    container: "mp4",
    webOptimize: true,
    moveInPlace: false,
    logLevel: "error",
    video: {
      encoder: "x264",
      library: "sw",
      rateMode: "quality",
      quality: 22,
      bitrate: 4000,
      twoPass: false,
      speed: "medium",
      profile: "auto",
      level: "auto",
      tune: "none",
      // "off" leaves the frame rate exactly as the source has it.
      fpsMode: "off",
      fps: "30",
      gop: 0,
    },
    audio: {
      encoder: "aac",
      track: 0,
      tracks: [0],
      extra: [],
      bitrate: 160,
      mixdown: "stereo",
      sampleRate: 48000,
      gain: 0,
      normalize: false,
    },
    picture: {
      scaleMode: "source",
      width: 1920,
      height: 1080,
      keepAspect: true,
      pad: false,
      cropTop: 0,
      cropBottom: 0,
      cropLeft: 0,
      cropRight: 0,
      cropDetect: false,
      pixelFormat: "",
    },
    filters: {
      deinterlace: "off",
      denoise: "off",
      deband: "off",
      blur: "off",
      sharpen: false,
      deblock: false,
      tonemap: false,
      color: { brightness: 0, contrast: 0, saturation: 0, gamma: 0, hue: 0 },
      rotate: 0,
      flipH: false,
      grayscale: false,
    },
    subtitle: { mode: "copy", track: 0, tracks: [0], extra: [] },
    trim: { enabled: false, start: 0, end: 0 },
    extra: { encoderOptions: "", inputArgs: "", outputArgs: "" },
  };
}

// A preset saved by an older build can be missing the fields added since, so
// fill them in from the defaults rather than letting `undefined` reach a panel.
export function normalizeSpec(spec: Spec): Spec {
  const base = defaultSettings();
  return {
    ...base,
    ...spec,
    video: { ...base.video, ...spec.video },
    audio: {
      ...base.audio,
      ...spec.audio,
      tracks: spec.audio?.tracks ?? base.audio.tracks,
      extra: spec.audio?.extra ?? [],
    },
    picture: { ...base.picture, ...spec.picture },
    filters: {
      ...base.filters,
      ...spec.filters,
      color: { ...base.filters.color, ...spec.filters?.color },
    },
    subtitle: {
      ...base.subtitle,
      ...spec.subtitle,
      tracks: spec.subtitle?.tracks ?? base.subtitle.tracks,
      extra: spec.subtitle?.extra ?? [],
    },
    trim: { ...base.trim, ...spec.trim },
    extra: { ...base.extra, ...spec.extra },
  };
}

export function defaultQueueSettings(): QueueSettings {
  return {
    verifyOutput: true,
    autoDeleteSource: false,
    shrinkThreshold: 20,
    postQueue: { type: "none", command: "", url: "" } as Hook,
  };
}
