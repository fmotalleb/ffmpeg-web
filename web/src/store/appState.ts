import type {
  EncoderCatalog,
  Job,
  MediaInfo,
  Preset,
  QueueSettings,
  Spec,
} from "../types";

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
