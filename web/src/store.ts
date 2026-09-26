import { create } from "zustand";
import type {
  EncoderCatalog,
  Hook,
  Job,
  MediaInfo,
  Preset,
  QueueSettings,
  Spec,
} from "./types";
import { codecForEncoder } from "./utils";

function defaultSettings(): Spec {
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
function normalizeSpec(spec: Spec): Spec {
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

function defaultQueueSettings(): QueueSettings {
  return {
    verifyOutput: true,
    autoDeleteSource: false,
    shrinkThreshold: 20,
    postQueue: { type: "none", command: "", url: "" } as Hook,
  };
}

export interface AppState {
  config: { root: string; outDir: string; allowCommands: boolean };
  source: MediaInfo | null;
  presets: Preset[];
  presetId: string | null;
  settings: Spec;
  queue: { paused: boolean; settings: QueueSettings };
  jobs: Map<string, Job>;
  editingJobId: string | null;
  previewJobId: string | null;
  activeTab: string;
  previewTime: number;
  previewDur: number;
  previewFrames: {
    time: number;
    sourceURL: string | null;
    targetURL: string | null;
    targetIsFinal: boolean;
  };
  diff: {
    overlayIsTarget: boolean;
    magnifier: boolean;
    magnifierShowsTarget: boolean;
    dividerPct: number;
    mode: "split" | "side-by-side" | "overlay" | "difference" | "flicker";
    opacity: number;
    magZoom: number;
    playing: boolean;
    syncOffset: number;
  };
  thumbSourceMode: "source" | "target";
  contactSheetBlob: Blob | null;
  browserDir: string | null;
  browserOpen: boolean;
  browserKind: "video" | "audio" | "subtitle";
  browserTarget: "source" | "audio" | "subtitle";
  batchDir: string | null;
  batchOpen: boolean;
  probeOpen: boolean;
  probeTitle: string;
  probeUrl: string;
  logViewPid: number | null;
  logViewTitle: string;
  railCollapsed: boolean;
  queueSettingsOpen: boolean;
  queueCollapsed: boolean;
  encoders: EncoderCatalog;

  setSource: (info: MediaInfo) => void;
  setSettings: (s: Partial<Spec>) => void;
  updateSettings: (path: string, value: unknown) => void;
  setActiveTab: (tab: string) => void;
  setEditingJobId: (id: string | null) => void;
  setPreviewJobId: (id: string | null) => void;
  setPresets: (p: Preset[]) => void;
  setPresetId: (id: string | null) => void;
  applyPreset: (p: Preset) => void;
  setConfig: (cfg: { root: string; outDir: string; allowCommands: boolean }) => void;
  setQueuePaused: (paused: boolean) => void;
  setQueueSettings: (s: QueueSettings) => void;
  setJobs: (jobs: Job[]) => void;
  updateJob: (job: Job) => void;
  removeJob: (id: string) => void;
  reorderJobs: (order: string[]) => void;
  setPreviewTime: (t: number) => void;
  setPreviewDur: (d: number) => void;
  setPreviewFrames: (f: AppState["previewFrames"]) => void;
  setDiffMode: (m: AppState["diff"]["mode"]) => void;
  setDiffPlaying: (p: boolean) => void;
  setThumbSourceMode: (m: "source" | "target") => void;
  setContactSheetBlob: (b: Blob | null) => void;
  setBrowserOpen: (open: boolean) => void;
  openBrowser: (kind: "video" | "audio" | "subtitle", target: "source" | "audio" | "subtitle") => void;
  setBrowserDir: (dir: string | null) => void;
  setBatchOpen: (open: boolean) => void;
  setBatchDir: (dir: string | null) => void;
  setProbe: (open: boolean, title?: string, url?: string) => void;
  setLogView: (pid: number | null, title?: string) => void;
  setRailCollapsed: (c: boolean) => void;
  setQueueSettingsOpen: (o: boolean) => void;
  setQueueCollapsed: (c: boolean) => void;
  setEncoders: (c: EncoderCatalog) => void;
  fitToSource: () => void;
}

const previewReset = { previewFrames: { time: 0, sourceURL: null, targetURL: null, targetIsFinal: false } };

export const useStore = create<AppState>((set, _get) => ({
  config: { root: "", outDir: "", allowCommands: false },
  source: null,
  presets: [],
  presetId: null,
  settings: defaultSettings(),
  queue: { paused: false, settings: defaultQueueSettings() },
  jobs: new Map(),
  editingJobId: null,
  previewJobId: null,
  activeTab: "summary",
  previewTime: 0,
  previewDur: 0.5,
  previewFrames: { time: 0, sourceURL: null, targetURL: null, targetIsFinal: false },
  diff: {
    overlayIsTarget: true,
    magnifier: false,
    magnifierShowsTarget: true,
    dividerPct: 50,
    mode: "split",
    opacity: 50,
    magZoom: 3,
    playing: false,
    syncOffset: 0,
  },
  thumbSourceMode: "source",
  contactSheetBlob: null,
  browserDir: null,
  browserOpen: false,
  browserKind: "video",
  browserTarget: "source",
  batchDir: null,
  batchOpen: false,
  probeOpen: false,
  probeTitle: "",
  probeUrl: "",
  logViewPid: null,
  logViewTitle: "",
  railCollapsed: false,
  queueSettingsOpen: false,
  queueCollapsed: false,
  encoders: { kinds: [], libraries: [] },

  setSource: (info) =>
    set((s) => {
      const settings = structuredClone(s.settings);
      settings.input = info.path;
      if (!settings.outputName) {
        settings.outputName = info.name.replace(/\.[^.]+$/, "");
      }
      // A different file means different timings: the trim range goes back to
      // the whole clip and the preview timeline starts over, so neither keeps
      // pointing at a moment the new file may not even have.
      settings.trim = { ...settings.trim, start: 0, end: info.duration };
      // A new source has its own streams: load every audio and subtitle track
      // into the keep lists so nothing is dropped by default, and drop files
      // added for the previous one.
      const audioTracks = info.audio.map((t) => t.index);
      const subTracks = info.subtitles.map((t) => t.index);
      settings.audio = {
        ...settings.audio,
        track: audioTracks[0] ?? 0,
        tracks: audioTracks,
        extra: [],
      };
      settings.subtitle = {
        ...settings.subtitle,
        track: subTracks[0] ?? 0,
        tracks: subTracks,
        extra: [],
      };
      return {
        source: info,
        settings,
        previewJobId: null,
        previewTime: 0,
        ...previewReset,
      };
    }),

  setSettings: (partial) =>
    set((s) => ({
      settings: { ...s.settings, ...partial } as Spec,
      presetId: null,
      ...previewReset,
    })),

  updateSettings: (path, value) =>
    set((s) => {
      const settings = structuredClone(s.settings);
      const keys = path.split(".");
      const last = keys.pop()!;
      const target = keys.reduce((o: Record<string, unknown>, k) => {
        if (o[k] == null) o[k] = {};
        return o[k] as Record<string, unknown>;
      }, settings as unknown as Record<string, unknown>);
      target[last] = value;
      return { settings, presetId: null, ...previewReset };
    }),

  setActiveTab: (tab) => set({ activeTab: tab }),
  setEditingJobId: (id) => set({ editingJobId: id }),
  setPreviewJobId: (id) =>
    set((s) => ({
      previewJobId: id,
      // A different job is a different timeline.
      previewTime: id === s.previewJobId ? s.previewTime : 0,
    })),
  setPresets: (p) => set({ presets: p }),
  setPresetId: (id) => set({ presetId: id }),

  applyPreset: (preset) =>
    set((s) => {
      const settings = normalizeSpec(structuredClone(preset.settings));
      settings.outputName = s.settings.outputName;
      settings.extra = s.settings.extra;
      settings.input = s.source ? s.source.path : "";
      // A preset never carries track lists — they belong to the file being
      // worked on — so refill them from the current source and keep every
      // track instead of falling back to a single one.
      if (s.source) {
        const audioTracks = s.source.audio.map((t) => t.index);
        const subTracks = s.source.subtitles.map((t) => t.index);
        settings.audio.track = audioTracks[0] ?? 0;
        settings.audio.tracks = audioTracks;
        settings.subtitle.track = subTracks[0] ?? 0;
        settings.subtitle.tracks = subTracks;
      }
      return { settings, presetId: preset.id, ...previewReset };
    }),

  setConfig: (cfg) => set({ config: cfg }),
  setQueuePaused: (paused) =>
    set((s) => ({ queue: { ...s.queue, paused } })),
  setQueueSettings: (settings) =>
    set((s) => ({ queue: { ...s.queue, settings } })),

  setJobs: (jobs) =>
    set(() => {
      const map = new Map<string, Job>();
      jobs.forEach((j) => map.set(j.id, j));
      return { jobs: map };
    }),

  updateJob: (job) =>
    set((s) => {
      const jobs = new Map(s.jobs);
      jobs.set(job.id, job);
      return { jobs };
    }),

  removeJob: (id) =>
    set((s) => {
      const jobs = new Map(s.jobs);
      jobs.delete(id);
      return { jobs };
    }),

  reorderJobs: (order) =>
    set((s) => {
      const next = new Map<string, Job>();
      order.forEach((id) => {
        const job = s.jobs.get(id);
        if (job) next.set(id, job);
      });
      s.jobs.forEach((job, id) => {
        if (!next.has(id)) next.set(id, job);
      });
      return { jobs: next };
    }),

  setPreviewTime: (t) => set({ previewTime: t }),
  setPreviewDur: (d) => set({ previewDur: d }),
  setPreviewFrames: (f) => set({ previewFrames: f }),
  setDiffMode: (mode) =>
    set((s) => ({ diff: { ...s.diff, mode } })),
  setDiffPlaying: (playing) =>
    set((s) => ({ diff: { ...s.diff, playing } })),
  setThumbSourceMode: (m) => set({ thumbSourceMode: m }),
  setContactSheetBlob: (b) => set({ contactSheetBlob: b }),
  setBrowserOpen: (open) => set({ browserOpen: open }),
  openBrowser: (kind, target) =>
    set({ browserOpen: true, browserKind: kind, browserTarget: target }),
  setBrowserDir: (dir) => set({ browserDir: dir }),
  setBatchOpen: (open) => set({ batchOpen: open }),
  setBatchDir: (dir) => set({ batchDir: dir }),
  setProbe: (open, title = "", url = "") =>
    set({ probeOpen: open, probeTitle: title, probeUrl: url }),
  setLogView: (pid, title = "") =>
    set({ logViewPid: pid, logViewTitle: title }),
  setRailCollapsed: (c) => set({ railCollapsed: c }),
  setQueueSettingsOpen: (o) => set({ queueSettingsOpen: o }),
  setQueueCollapsed: (c) => set({ queueCollapsed: c }),
  setEncoders: (c) =>
    set((s) => {
      // Keep the chosen library valid: if the current pick is missing from the
      // catalog that came back (an old spec, or a codec that changed), fall
      // back to the software entry so the select always shows something.
      const codec = codecForEncoder[s.settings.video.encoder];
      const libs = c.libraries.filter((l) => l.codec === codec);
      if (!libs.some((l) => l.id === s.settings.video.library)) {
        const fallback = libs.find((l) => l.kind === "cpu")?.id ?? libs[0]?.id ?? "sw";
        return {
          encoders: c,
          settings: {
            ...s.settings,
            video: { ...s.settings.video, library: fallback },
          },
        };
      }
      return { encoders: c };
    }),

  fitToSource: () =>
    set((s) => {
      const src = s.source;
      const pic = s.settings.picture;
      if (!src || !src.video || pic.scaleMode !== "custom") return {};
      const settings = structuredClone(s.settings);
      if (src.video.width && src.video.width < settings.picture.width && !settings.picture.pad) {
        settings.picture.width = src.video.width;
        settings.picture.height = src.video.height;
      }
      if (src.video.interlaced && settings.filters.deinterlace === "off") {
        settings.filters.deinterlace = "bwdif";
      }
      return { settings };
    }),
}));
