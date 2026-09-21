import { create } from "zustand";
import type {
  Hook,
  Job,
  MediaInfo,
  Preset,
  QueueSettings,
  Spec,
} from "./types";

function defaultSettings(): Spec {
  return {
    input: "",
    outputName: "",
    container: "mp4",
    webOptimize: true,
    video: {
      encoder: "x264",
      rateMode: "quality",
      quality: 22,
      bitrate: 4000,
      twoPass: false,
      speed: "medium",
      profile: "auto",
      level: "auto",
      tune: "none",
      fpsMode: "same",
      fps: "30",
      gop: 0,
    },
    audio: {
      encoder: "aac",
      track: 0,
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
      sharpen: false,
      deblock: false,
      rotate: 0,
      flipH: false,
      grayscale: false,
    },
    subtitle: { mode: "none", track: 0 },
    trim: { enabled: false, start: 0, end: 0 },
    extra: { encoderOptions: "", inputArgs: "", outputArgs: "" },
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
  batchDir: string | null;
  batchOpen: boolean;
  probeOpen: boolean;
  probeTitle: string;
  probeUrl: string;
  railCollapsed: boolean;
  queueSettingsOpen: boolean;

  setSource: (info: MediaInfo) => void;
  setSettings: (s: Partial<Spec>) => void;
  updateSettings: (path: string, value: unknown) => void;
  setActiveTab: (tab: string) => void;
  setEditingJobId: (id: string | null) => void;
  setPreviewJobId: (id: string | null) => void;
  setPresets: (p: Preset[]) => void;
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
  setBrowserDir: (dir: string | null) => void;
  setBatchOpen: (open: boolean) => void;
  setBatchDir: (dir: string | null) => void;
  setProbe: (open: boolean, title?: string, url?: string) => void;
  setRailCollapsed: (c: boolean) => void;
  setQueueSettingsOpen: (o: boolean) => void;
  fitToSource: () => void;
}

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
  batchDir: null,
  batchOpen: false,
  probeOpen: false,
  probeTitle: "",
  probeUrl: "",
  railCollapsed: false,
  queueSettingsOpen: false,

  setSource: (info) =>
    set((s) => {
      const settings = { ...s.settings };
      settings.input = info.path;
      if (!settings.outputName) {
        settings.outputName = info.name.replace(/\.[^.]+$/, "");
      }
      settings.trim.end = info.duration;
      settings.audio.track = info.audio.length ? info.audio[0].index : 0;
      settings.subtitle.track = info.subtitles.length ? info.subtitles[0].index : 0;
      return { source: info, settings, previewJobId: null };
    }),

  setSettings: (partial) =>
    set((s) => ({
      settings: { ...s.settings, ...partial } as Spec,
      presetId: null,
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
      return { settings, presetId: null };
    }),

  setActiveTab: (tab) => set({ activeTab: tab }),
  setEditingJobId: (id) => set({ editingJobId: id }),
  setPreviewJobId: (id) => set({ previewJobId: id }),
  setPresets: (p) => set({ presets: p }),

  applyPreset: (preset) =>
    set((s) => {
      const settings = { ...defaultSettings(), ...structuredClone(preset.settings) };
      settings.outputName = s.settings.outputName;
      settings.extra = s.settings.extra;
      settings.input = s.source ? s.source.path : "";
      return { settings, presetId: preset.id };
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
  setBrowserDir: (dir) => set({ browserDir: dir }),
  setBatchOpen: (open) => set({ batchOpen: open }),
  setBatchDir: (dir) => set({ batchDir: dir }),
  setProbe: (open, title = "", url = "") =>
    set({ probeOpen: open, probeTitle: title, probeUrl: url }),
  setRailCollapsed: (c) => set({ railCollapsed: c }),
  setQueueSettingsOpen: (o) => set({ queueSettingsOpen: o }),

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
