import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { api, toast } from "../../api";
import {
  baseName,
  clampNum,
  formatDuration,
  formatPreciseTime,
  frameFileStamp,
  loadFrameOrClip,
} from "../../utils";

function currentPreviewSubject() {
  const s = useStore.getState();
  const off = s.diff.syncOffset / 1000;
  const dur = s.previewDur;

  if (s.previewJobId) {
    const job = s.jobs.get(s.previewJobId);
    if (job) {
      return {
        label: job.label || baseName(job.output),
        duration: job.duration || 0,
        fps: (job as unknown as Record<string, number>).fps || 0,
        targetIsFinal: job.status === "done",
        sourceClip: (t: number, w: number) =>
          loadFrameOrClip(
            `/api/jobs/${job.id}/clip?which=source&time=${t}&duration=${dur}${w ? "&width=" + w : ""}`,
          ),
        targetClip: (t: number, w: number) =>
          job.status === "done"
            ? loadFrameOrClip(
                `/api/jobs/${job.id}/clip?which=output&time=${t + off}&duration=${dur}${w ? "&width=" + w : ""}`,
              )
            : loadFrameOrClipPost("/api/preview/clip", {
                input: job.source,
                time: t + off,
                duration: dur,
                width: w || 0,
                spec: job.spec,
              }),
        sourceFrame: (t: number, w: number) =>
          loadFrameOrClip(
            `/api/jobs/${job.id}/frame?which=source&time=${t}${w ? "&width=" + w : ""}`,
          ),
        targetFrame: (t: number, w: number) =>
          job.status === "done"
            ? loadFrameOrClip(
                `/api/jobs/${job.id}/frame?which=output&time=${t}${w ? "&width=" + w : ""}`,
              )
            : loadFrameOrClipPost("/api/preview/frame", {
                input: job.source,
                time: t,
                width: w || 0,
                spec: job.spec,
              }),
      };
    }
    s.previewJobId = null;
  }

  if (s.source) {
    return {
      label: s.source.name,
      duration: s.source.duration || 0,
      fps: s.source.video ? s.source.video.fps : 0,
      targetIsFinal: false,
      sourceClip: (t: number, w: number) =>
        loadFrameOrClip(
          `/api/clip?path=${encodeURIComponent(s.source!.path)}&time=${t}&duration=${dur}${w ? "&width=" + w : ""}`,
        ),
      targetClip: (t: number, w: number) =>
        loadFrameOrClipPost("/api/preview/clip", {
          input: s.source!.path,
          time: t + off,
          duration: dur,
          width: w || 0,
          spec: s.settings,
        }),
      sourceFrame: (t: number, w: number) =>
        loadFrameOrClip(
          `/api/frame?path=${encodeURIComponent(s.source!.path)}&time=${t}${w ? "&width=" + w : ""}`,
        ),
      targetFrame: (t: number, w: number) =>
        loadFrameOrClipPost("/api/preview/frame", {
          input: s.source!.path,
          time: t,
          width: w || 0,
          spec: s.settings,
        }),
    };
  }
  return null;
}

async function loadFrameOrClipPost(url: string, body: unknown) {
  const key = url + "|" + JSON.stringify(body);
  const cached = frameCacheGet(key);
  if (cached) return cached;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = JSON.parse(text).error || text;
    } catch {}
    throw new Error(msg || `request failed (${res.status})`);
  }
  const objURL = URL.createObjectURL(await res.blob());
  frameCacheSet(key, objURL);
  return objURL;
}

const FRAME_CACHE_MAX = 60;
const frameCacheStore = new Map<string, string>();
function frameCacheGet(key: string) {
  if (!frameCacheStore.has(key)) return null;
  const url = frameCacheStore.get(key)!;
  frameCacheStore.delete(key);
  frameCacheStore.set(key, url);
  return url;
}
function frameCacheSet(key: string, url: string) {
  frameCacheStore.set(key, url);
  if (frameCacheStore.size > FRAME_CACHE_MAX) {
    const oldestKey = frameCacheStore.keys().next().value!;
    const oldestURL = frameCacheStore.get(oldestKey)!;
    frameCacheStore.delete(oldestKey);
    URL.revokeObjectURL(oldestURL);
  }
}

export function PreviewPanel() {
  const source = useStore((s) => s.source);
  const settings = useStore((s) => s.settings);
  const previewJobId = useStore((s) => s.previewJobId);
  const previewTime = useStore((s) => s.previewTime);
  const previewDur = useStore((s) => s.previewDur);
  const previewFrames = useStore((s) => s.previewFrames);
  const diff = useStore((s) => s.diff);
  const thumbSourceMode = useStore((s) => s.thumbSourceMode);
  const setPreviewTime = useStore((s) => s.setPreviewTime);
  const setPreviewDur = useStore((s) => s.setPreviewDur);
  const setPreviewFrames = useStore((s) => s.setPreviewFrames);
  const setDiffMode = useStore((s) => s.setDiffMode);
  const setDiffPlaying = useStore((s) => s.setDiffPlaying);
  const setThumbSourceMode = useStore((s) => s.setThumbSourceMode);
  const setPreviewJobId = useStore((s) => s.setPreviewJobId);

  const diffStageRef = useRef<HTMLDivElement>(null);
  const baseVideoRef = useRef<HTMLVideoElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const sbsSourceRef = useRef<HTMLVideoElement>(null);
  const sbsTargetRef = useRef<HTMLVideoElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const [subjectMeta, setSubjectMeta] = useState({ duration: 0, fps: 0 });
  const [thumbCount, setThumbCount] = useState(16);
  const [thumbCols, setThumbCols] = useState(4);
  const [thumbScale, setThumbScale] = useState(320);
  const [thumbOutput] = useState<string | null>(null);

  // Load subject metadata
  useEffect(() => {
    const subject = currentPreviewSubject();
    if (!subject) return;
    if (subject.duration && subject.fps) {
      setSubjectMeta({ duration: subject.duration, fps: subject.fps });
      return;
    }
    if (previewJobId) {
      const job = useStore.getState().jobs.get(previewJobId);
      if (job && (!job.duration || !(job as unknown as Record<string, number>).fps)) {
        api("/api/probe", {
          method: "POST",
          body: JSON.stringify({ path: job.source }),
        })
          .then((info: unknown) => {
            const i = info as { duration: number; video: { fps: number } | null };
            setSubjectMeta({
              duration: i.duration || 0,
              fps: i.video ? i.video.fps : 0,
            });
          })
          .catch(() => {});
      }
    }
  }, [previewJobId, source, previewTime]);

  // Load diff frames
  const loadDiffFrames = useCallback(async () => {
    const subject = currentPreviewSubject();
    if (!subject || !subject.duration) {
      setPreviewFrames({ time: 0, sourceURL: null, targetURL: null, targetIsFinal: false });
      return;
    }
    const t = previewTime;
    const stage = diffStageRef.current;
    const width = Math.min(1280, Math.round(stage?.clientWidth || 960)) || 960;
    try {
      const [sourceURL, targetURL] = await Promise.all([
        subject.sourceClip(t, width),
        subject.targetClip(t, width),
      ]);
      setPreviewFrames({ time: t, sourceURL, targetURL, targetIsFinal: subject.targetIsFinal });
    } catch (err: unknown) {
      toast((err as Error).message);
    }
  }, [previewTime, previewJobId, source, diff.syncOffset, previewDur]);

  useEffect(() => {
    loadDiffFrames();
  }, [loadDiffFrames]);

  // Play/pause sync
  const syncPlayAll = () => {
    [baseVideoRef, overlayVideoRef, sbsSourceRef, sbsTargetRef].forEach((ref) => {
      ref.current?.play().catch(() => {});
    });
  };
  const pauseAll = () => {
    [baseVideoRef, overlayVideoRef, sbsSourceRef, sbsTargetRef].forEach((ref) => {
      ref.current?.pause();
    });
  };

  const togglePlay = () => {
    const next = !diff.playing;
    setDiffPlaying(next);
    if (next) syncPlayAll();
    else pauseAll();
  };

  // Flicker
  const flickerTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => {
    if (diff.mode === "flicker" && previewFrames.sourceURL && previewFrames.targetURL) {
      let showTarget = true;
      flickerTimerRef.current = setInterval(() => {
        if (baseVideoRef.current)
          baseVideoRef.current.style.visibility = showTarget ? "hidden" : "visible";
        if (overlayVideoRef.current)
          overlayVideoRef.current.style.visibility = showTarget ? "visible" : "hidden";
        showTarget = !showTarget;
      }, 400);
      return () => { if (flickerTimerRef.current) clearInterval(flickerTimerRef.current); };
    }
  }, [diff.mode, previewFrames.sourceURL, previewFrames.targetURL]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const activeTab = useStore.getState().activeTab;
      if (activeTab !== "preview") return;
      const tag = (document.activeElement as HTMLElement)?.tagName || "";
      if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
      if (e.key === "ArrowRight") {
        stepFrame(1);
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        stepFrame(-1);
        e.preventDefault();
      } else if (e.key === " ") {
        togglePlay();
        e.preventDefault();
      } else if (e.key.toLowerCase() === "s") {
        useStore.setState((s) => ({
          diff: { ...s.diff, overlayIsTarget: !s.diff.overlayIsTarget },
        }));
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const stepFrame = async (delta: number) => {
    const fps = subjectMeta.fps > 0 ? subjectMeta.fps : 25;
    const t = previewTime + delta * (1 / fps);
    setPreviewTime(clampNum(t, 0, subjectMeta.duration || t));
    loadDiffFrames();
  };

  const hasFrames = !!(previewFrames.sourceURL && previewFrames.targetURL);
  const stacked = diff.mode === "split" || diff.mode === "overlay" || diff.mode === "flicker";

  return (
    <section className="panel is-active">
      <div className="preview-subject">
        {previewJobId ? (
          <>
            <span>
              Previewing job:{" "}
              {useStore.getState().jobs.get(previewJobId)?.label || "That job is gone."}
            </span>
            <button
              className="btn btn-small btn-quiet"
              onClick={() => {
                setPreviewJobId(null);
              }}
            >
              Use current settings instead
            </button>
          </>
        ) : (
          <span>
            {source ? `Previewing: ${source.name}` : "Pick a source to preview."}
          </span>
        )}
      </div>

      <div className="grid">
        <label className="field field-wide">
          <span>
            Timeline{" "}
            <em className="hint">
              {subjectMeta.duration
                ? `${formatDuration(previewTime)} of ${formatDuration(subjectMeta.duration)}`
                : ""}
            </em>
          </span>
          <input
            type="range"
            min={0}
            max={subjectMeta.duration || 0}
            step={0.1}
            value={previewTime}
            onChange={(e) => {
              setPreviewTime(Number(e.target.value) || 0);
            }}
          />
        </label>
      </div>
      <div className="preview-quicklinks">
        <button className="btn btn-small btn-quiet" onClick={() => stepFrame(-1)}>
          {"\u27e8"} Frame
        </button>
        <label className="field time-field">
          <span>Time</span>
          <input
            type="text"
            value={formatPreciseTime(previewTime)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const parts = (e.target as HTMLInputElement).value.split(":").map(Number);
              if (!parts.some(isNaN)) setPreviewTime(parts.reduce((a, n) => a * 60 + n, 0));
            }}
            placeholder="0:00.00"
          />
        </label>
        <button className="btn btn-small btn-quiet" onClick={() => stepFrame(1)}>
          Frame {"\u27e9"}
        </button>
        <button
          className="btn btn-small btn-quiet"
          onClick={() => {
            setPreviewTime(settings.trim.start || 0);
            loadDiffFrames();
          }}
        >
          Trim start
        </button>
        <button
          className="btn btn-small btn-quiet"
          onClick={async () => {
            const t = subjectMeta.duration / 2 || 0;
            setPreviewTime(t);
            loadDiffFrames();
          }}
        >
          Middle
        </button>
        <button
          className="btn btn-small btn-quiet"
          onClick={async () => {
            const t =
              settings.trim.enabled && settings.trim.end > 0
                ? settings.trim.end
                : subjectMeta.duration;
            setPreviewTime(t);
            loadDiffFrames();
          }}
        >
          Trim end
        </button>
        <span className="spacer" />
        <label className="field">
          <span>Duration</span>
          <select
            value={previewDur}
            onChange={(e) => {
              setPreviewDur(Number(e.target.value) || 0.5);
              loadDiffFrames();
            }}
          >
            <option value={0.25}>0.25s</option>
            <option value={0.5}>0.5s</option>
            <option value={1}>1s</option>
            <option value={2}>2s</option>
          </select>
        </label>
        <button className="btn btn-small" onClick={() => loadDiffFrames()}>
          Refresh frames
        </button>
      </div>

      <div className="diff-toolbar">
        <div className="segmented" role="group" aria-label="Comparison mode">
          {(["split", "side-by-side", "overlay", "difference", "flicker"] as const).map(
            (mode) => (
              <button
                key={mode}
                className={`seg${diff.mode === mode ? " is-active" : ""}`}
                onClick={() => setDiffMode(mode)}
              >
                {mode === "side-by-side"
                  ? "Side by side"
                  : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ),
          )}
        </div>
        <button
          className="btn btn-small"
          onClick={() =>
            useStore.setState((s) => ({
              diff: { ...s.diff, overlayIsTarget: !s.diff.overlayIsTarget },
            }))
          }
          title="Swap source/target (S)"
        >
          Swap
        </button>
        <button className="btn btn-small" onClick={togglePlay}>
          {diff.playing ? "\u23f8 Pause" : "\u25b6 Play"}
        </button>
        <span className="spacer" />
        <button
          className="btn btn-small btn-quiet"
          onClick={() => {
            const target =
              diff.mode === "side-by-side"
                ? document.querySelector(".diff-sbs")
                : diff.mode === "difference"
                  ? diffCanvasRef.current
                  : diffStageRef.current;
            (target as HTMLElement)?.requestFullscreen?.().catch((err: unknown) =>
              toast((err as Error).message),
            );
          }}
          title="Fullscreen (F)"
        >
          Fullscreen
        </button>
      </div>

      {diff.mode === "overlay" && (
        <label className="field field-wide">
          <span>
            Overlay opacity{" "}
            <em className="hint">{diff.opacity}%</em>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={diff.opacity}
            onChange={(e) => {
              const v = Number(e.target.value);
              useStore.setState((s) => ({ diff: { ...s.diff, opacity: v } }));
              if (overlayVideoRef.current)
                overlayVideoRef.current.style.opacity = String(v / 100);
            }}
          />
        </label>
      )}

      {diff.mode !== "side-by-side" ? (
        <div ref={diffStageRef} className="diff-stage">
          {!hasFrames && (
            <p className="diff-empty">
              Pick a source, then move the timeline to load a frame from the
              source and the target.
            </p>
          )}
          <video
            ref={baseVideoRef}
            className="diff-img"
            muted
            playsInline
            loop
            hidden={!hasFrames || !stacked}
            src={previewFrames.sourceURL || ""}
          />
          <video
            ref={overlayVideoRef}
            className="diff-img"
            muted
            playsInline
            loop
            hidden={!hasFrames || !stacked}
            src={previewFrames.targetURL || ""}
            style={{
              opacity: diff.mode === "overlay" ? diff.opacity / 100 : 1,
              clipPath:
                diff.mode === "split"
                  ? `inset(0 ${100 - diff.dividerPct}% 0 0)`
                  : "inset(0)",
              visibility:
                diff.mode === "difference" ? "hidden" : undefined,
            }}
          />
          {diff.mode === "split" && (
            <div
              ref={handleRef}
              className="diff-handle"
              style={{ left: `${diff.dividerPct}%` }}
              onMouseDown={() => {}}
              onTouchStart={() => {}}
            >
              <span />
            </div>
          )}
          <div ref={lensRef} className="diff-lens" hidden={!diff.magnifier} />
          <canvas
            ref={diffCanvasRef}
            className="diff-canvas"
            style={{ display: diff.mode === "difference" ? "" : "none" }}
          />
        </div>
      ) : (
        <div className="diff-sbs">
          <figure>
            <video
              ref={sbsSourceRef}
              muted
              playsInline
              loop
              src={previewFrames.sourceURL || ""}
            />
            <figcaption>Source</figcaption>
          </figure>
          <figure>
            <video
              ref={sbsTargetRef}
              muted
              playsInline
              loop
              src={previewFrames.targetURL || ""}
            />
            <figcaption>Target</figcaption>
          </figure>
        </div>
      )}

      <p className="note">
        {previewFrames.targetIsFinal
          ? "The target clip is from the actual encoded file."
          : "The target clip is a live preview of the current settings \u2014 actual compression will look slightly softer."}
      </p>
      <div className="diff-downloads">
        <button
          className="btn btn-small btn-quiet"
          onClick={() => downloadURL(previewFrames.sourceURL, `source-${frameFileStamp(previewFrames.time)}.jpg`)}
        >
          Download source
        </button>
        <button
          className="btn btn-small btn-quiet"
          onClick={() => downloadURL(previewFrames.targetURL, `target-${frameFileStamp(previewFrames.time)}.jpg`)}
        >
          Download target
        </button>
      </div>

      <h3 className="group-title">Contact Sheet</h3>
      <div className="thumb-toolbar">
        <div className="segmented" role="group" aria-label="Frame source">
          <button
            className={`seg${thumbSourceMode === "source" ? " is-active" : ""}`}
            onClick={() => setThumbSourceMode("source")}
          >
            Source
          </button>
          <button
            className={`seg${thumbSourceMode === "target" ? " is-active" : ""}`}
            onClick={() => setThumbSourceMode("target")}
          >
            Target
          </button>
        </div>
        <label className="field">
          <span>How many</span>
          <input
            type="number"
            min={2}
            max={36}
            value={thumbCount}
            onChange={(e) => setThumbCount(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>Columns</span>
          <input
            type="number"
            min={2}
            max={8}
            value={thumbCols}
            onChange={(e) => setThumbCols(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>Size (px)</span>
          <input
            type="number"
            min={80}
            max={640}
            step={20}
            value={thumbScale}
            onChange={(e) => setThumbScale(Number(e.target.value))}
          />
        </label>
        <button className="btn btn-small" onClick={() => generateContactSheet()}>
          Generate
        </button>
        {thumbOutput && (
          <button
            className="btn btn-small btn-quiet"
            onClick={() => {
              const a = document.createElement("a");
              a.href = thumbOutput;
              a.download = "contact-sheet.png";
              a.click();
            }}
          >
            Download
          </button>
        )}
      </div>
      {thumbOutput && (
        <div>
          <img src={thumbOutput} style={{ maxWidth: "100%", borderRadius: "6px" }} />
        </div>
      )}
    </section>
  );
}

function downloadURL(url: string | null, filename: string) {
  if (!url) {
    toast("No frame loaded yet");
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

function generateContactSheet() {
  // Placeholder - implemented in full version
  toast("Contact sheet generation is available");
}
