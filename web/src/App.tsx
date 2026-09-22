import { useEffect, useRef } from "react";
import { useStore } from "./store";
import { api, setToastHandler, toast as apiToast } from "./api";
import { TopBar } from "./components/TopBar";
import { PresetsRail } from "./components/PresetsRail";
import { SourceStrip } from "./components/SourceStrip";
import { Tabs } from "./components/Tabs";
import { SummaryPanel } from "./components/panels/SummaryPanel";
import { VideoPanel } from "./components/panels/VideoPanel";
import { AudioPanel } from "./components/panels/AudioPanel";
import { SubtitlesPanel } from "./components/panels/SubtitlesPanel";
import { FiltersPanel } from "./components/panels/FiltersPanel";
import { DimensionsPanel } from "./components/panels/DimensionsPanel";
import { AdvancedPanel } from "./components/panels/AdvancedPanel";
import { PreviewPanel } from "./components/panels/PreviewPanel";
import { Queue } from "./components/Queue";
import { FileBrowser } from "./components/modals/FileBrowser";
import { BatchEncode } from "./components/modals/BatchEncode";
import { ProbeViewer } from "./components/modals/ProbeViewer";
import { FfmpegLogViewer } from "./components/modals/FfmpegLogViewer";
import { Toast } from "./components/Toast";
import type { EncoderCatalog, Job, Snapshot } from "./types";

export function App() {
  const {
    setConfig,
    setPresets,
    setJobs,
    setQueuePaused,
    setQueueSettings,
    updateJob,
    removeJob,
    reorderJobs,
    fitToSource,
    setEncoders,
    source,
  } = useStore();

  const presetsLoaded = useRef(false);

  // Toast handler
  useEffect(() => {
    setToastHandler(apiToast);
  }, []);

  // Load config
  useEffect(() => {
    api<{ root: string; outDir: string; allowCommands: boolean }>("/api/config")
      .then((cfg) => setConfig(cfg))
      .catch(() => {});
  }, [setConfig]);

  // Load the encoder library catalog (which libraries this ffmpeg build has)
  useEffect(() => {
    api<EncoderCatalog>("/api/encoders")
      .then((catalog) => setEncoders(catalog))
      .catch(() => {});
  }, [setEncoders]);

  // Load presets + apply first
  useEffect(() => {
    if (presetsLoaded.current) return;
    presetsLoaded.current = true;
    api<import("./types").Preset[]>("/api/presets")
      .then((list) => {
        setPresets(list);
        const first = list.find((p) => p.id === "general-1080p30") || list[0];
        if (first) {
          useStore.getState().applyPreset(first);
        }
      })
      .catch((err) => apiToast(err.message));
  }, [setPresets]);

  // SSE connection
  useEffect(() => {
    const source = new EventSource("/api/events");

    source.addEventListener("snapshot", (e) => {
      const data: Snapshot = JSON.parse(e.data);
      setJobs(data.jobs || []);
      if (typeof data.paused === "boolean") setQueuePaused(data.paused);
      if (data.settings) setQueueSettings(data.settings);
    });

    source.addEventListener("job", (e) => {
      const job: Job = JSON.parse(e.data);
      updateJob(job);
    });

    source.addEventListener("queue", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.removed) removeJob(msg.removed);
      if (typeof msg.paused === "boolean") setQueuePaused(msg.paused);
      if (msg.settings) setQueueSettings(msg.settings);
      if (msg.order) reorderJobs(msg.order);
      if (msg.drained) {
        apiToast(
          `Queue finished — ${msg.drained.done} done` +
            (msg.drained.failed ? `, ${msg.drained.failed} failed` : ""),
          !msg.drained.failed,
        );
      }
    });

    source.onerror = () => {};
    return () => source.close();
  }, [setJobs, setQueuePaused, setQueueSettings, updateJob, removeJob, reorderJobs]);

  // Apply visibility after render
  useEffect(() => {
    // Fit to source when source changes
    if (source) fitToSource();
  }, [source, fitToSource]);

  const activeTab = useStore((s) => s.activeTab);
  const railCollapsed = useStore((s) => s.railCollapsed);

  return (
    <>
      <TopBar />
      <main className={`shell${railCollapsed ? " rail-collapsed" : ""}`}>
        <PresetsRail />
        <section className="work">
          <SourceStrip />
          <Tabs />
          <div className="panels">
            {activeTab === "summary" && <SummaryPanel />}
            {activeTab === "video" && <VideoPanel />}
            {activeTab === "audio" && <AudioPanel />}
            {activeTab === "subtitles" && <SubtitlesPanel />}
            {activeTab === "filters" && <FiltersPanel />}
            {activeTab === "dimensions" && <DimensionsPanel />}
            {activeTab === "advanced" && <AdvancedPanel />}
            {activeTab === "preview" && <PreviewPanel />}
          </div>
        </section>
      </main>
      <Queue />
      <FileBrowser />
      <BatchEncode />
      <ProbeViewer />
      <FfmpegLogViewer />
      <Toast />
    </>
  );
}
