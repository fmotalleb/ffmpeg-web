import { useEffect, useRef } from "react";
import { useStore } from "./store";
import { api, toast as apiToast } from "./api";
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
import { FfmpegProcessViewer } from "./components/modals/FfmpegProcessViewer";
import { ConfirmDialog } from "./components/modals/ConfirmDialog";
import { Toast } from "./components/Toast";
import { notifyJobFinished } from "./notify";
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
  // Last seen status per job, so the SSE handler can tell a job that just
  // finished from one we've already reported.
  const lastStatusRef = useRef(new Map<string, string>());

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
      const list = data.jobs || [];
      // Rebuild (not merge) the status map, and seed it without firing alerts —
      // jobs already finished before this page loaded aren't news.
      lastStatusRef.current = new Map(list.map((j) => [j.id, j.status]));
      setJobs(list);
      if (typeof data.paused === "boolean") setQueuePaused(data.paused);
      if (data.settings) setQueueSettings(data.settings);
    });

    source.addEventListener("job", (e) => {
      const job: Job = JSON.parse(e.data);
      const prev = lastStatusRef.current.get(job.id);
      lastStatusRef.current.set(job.id, job.status);
      // Only a transition into a finished state is worth an alert; the first
      // sight of a job that is already done (reconnect) is not.
      const finished = job.status === "done" || job.status === "failed";
      const wasActive = prev === "queued" || prev === "running";
      if (finished && wasActive && useStore.getState().notifyOnDone) {
        notifyJobFinished(job);
      }
      updateJob(job);
    });

    source.addEventListener("queue", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.removed) {
        lastStatusRef.current.delete(msg.removed);
        removeJob(msg.removed);
      }
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
      <FfmpegProcessViewer />
      <ConfirmDialog />
      <Toast />
    </>
  );
}
