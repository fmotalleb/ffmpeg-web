import { create } from "zustand";
import type { Job, Spec } from "../types";
import { codecForEncoder } from "../utils";
import { defaultQueueSettings, defaultSettings, normalizeSpec } from "./defaults";
import type { AppState } from "./appState";

export type { AppState } from "./appState";

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
  processViewPid: null,
  railCollapsed: false,
  queueSettingsOpen: false,
  // The queue is a drawer, not the main view: it starts closed and opens
  // itself when something is queued (see setJobs/updateJob).
  queueCollapsed: true,
  encoders: { kinds: [], libraries: [] },

  setSource: (info) =>
    set((s) => {
      const settings = structuredClone(s.settings);
      settings.input = info.path;
      // A new file gets a new name: the "save as" box follows the file being
      // worked on, instead of keeping whatever was typed for the last one.
      settings.outputName = info.name.replace(/\.[^.]+$/, "");
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
    set((s) => {
      const map = new Map<string, Job>();
      jobs.forEach((j) => map.set(j.id, j));
      // Newly queued work is the queue's cue to show itself: a job that was not
      // here a moment ago and is waiting to run opens the closed list.
      const queued = jobs.some((j) => j.status === "queued" && !s.jobs.has(j.id));
      return queued ? { jobs: map, queueCollapsed: false } : { jobs: map };
    }),

  updateJob: (job) =>
    set((s) => {
      const jobs = new Map(s.jobs);
      const isNew = !jobs.has(job.id);
      jobs.set(job.id, job);
      if (isNew && job.status === "queued") {
        return { jobs, queueCollapsed: false };
      }
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
  setProcessViewPid: (pid) => set({ processViewPid: pid }),
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
