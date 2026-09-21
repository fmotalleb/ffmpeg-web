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
    try { msg = JSON.parse(text).error || text; } catch {}
    throw new Error(msg || `request failed (${res.status})`);
  }
  const objURL = URL.createObjectURL(await res.blob());
  frameCacheSet(key, objURL);
  return objURL;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
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
function frameCacheClear() {
  frameCacheStore.forEach((url) => URL.revokeObjectURL(url));
  frameCacheStore.clear();
}

export function PreviewPanel() {
  const previewJobId = useStore((s) => s.previewJobId);
  const previewTime = useStore((s) => s.previewTime);
  const previewDur = useStore((s) => s.previewDur);
  const previewFrames = useStore((s) => s.previewFrames);
  const diff = useStore((s) => s.diff);

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
  const [thumbOutput, setThumbOutput] = useState<string | null>(null);
  const [thumbGenerating, setThumbGenerating] = useState(false);
  const [magnifierZoom, setMagnifierZoom] = useState(3);
  const magnifierZoomRef = useRef(magnifierZoom);
  const [magnifierShowsTarget, setMagnifierShowsTarget] = useState(true);
  const magnifierShowsTargetRef = useRef(magnifierShowsTarget);
  useEffect(() => { magnifierZoomRef.current = magnifierZoom; }, [magnifierZoom]);
  useEffect(() => { magnifierShowsTargetRef.current = magnifierShowsTarget; }, [magnifierShowsTarget]);

  // Stable refs for values used in event handlers / callbacks
  const previewTimeRef = useRef(previewTime);
  previewTimeRef.current = previewTime;
  const diffRef = useRef(diff);
  diffRef.current = diff;
  const previewFramesRef = useRef(previewFrames);
  previewFramesRef.current = previewFrames;
  const subjectMetaRef = useRef(subjectMeta);
  subjectMetaRef.current = subjectMeta;

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
  }, [previewJobId]);

  // Load diff frames — only depends on the values that determine the URL,
  // not on previewTime (which changes every slider tick).
  // Uses a ref for previewTime so it always reads the latest value.
  const loadSeqRef = useRef(0);
  const loadDiffFrames = useCallback(async () => {
    const subject = currentPreviewSubject();
    if (!subject || !subject.duration) {
      useStore.getState().setPreviewFrames({ time: 0, sourceURL: null, targetURL: null, targetIsFinal: false });
      return;
    }
    const t = previewTimeRef.current;
    const stage = diffStageRef.current;
    const width = Math.min(1280, Math.round(stage?.clientWidth || 960)) || 960;
    const seq = ++loadSeqRef.current;
    try {
      const [sourceURL, targetURL] = await Promise.all([
        subject.sourceClip(t, width),
        subject.targetClip(t, width),
      ]);
      if (seq !== loadSeqRef.current) return;
      useStore.getState().setPreviewFrames({ time: t, sourceURL, targetURL, targetIsFinal: subject.targetIsFinal });
    } catch (err: unknown) {
      if (seq !== loadSeqRef.current) return;
      toast((err as Error).message);
    }
  }, []);

  // Debounced auto-load: when previewTime or settings change, schedule a load after 80ms.
  // If previewTime changes again before the timer fires, the old timer is cleared.
  const loadTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settings = useStore((s) => s.settings);
  useEffect(() => {
    clearTimeout(loadTimerRef.current);
    // Clear cache when settings/preset changes to force reload from server
    if (settings) frameCacheClear();
    loadTimerRef.current = setTimeout(loadDiffFrames, 80);
    return () => clearTimeout(loadTimerRef.current);
  }, [previewTime, previewDur, previewJobId, diff.syncOffset, settings, loadDiffFrames]);

  // Immediate load on source change (no debounce)
  const source = useStore((s) => s.source);
  useEffect(() => {
    frameCacheClear();
    loadDiffFrames();
  }, [source, previewJobId, loadDiffFrames]);

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

  const togglePlay = useCallback(() => {
    const next = !diffRef.current.playing;
    useStore.getState().setDiffPlaying(next);
    if (next) syncPlayAll();
    else pauseAll();
  }, []);

  // Flicker
  const flickerTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const flickerShowingResult = useRef(true);
  const [flickerLabel, setFlickerLabel] = useState("Result");
  useEffect(() => {
    if (diff.mode === "flicker" && previewFrames.sourceURL && previewFrames.targetURL) {
      let showResult = true;
      setFlickerLabel("Result");
      flickerTimerRef.current = setInterval(() => {
        showResult = !showResult;
        flickerShowingResult.current = showResult;
        setFlickerLabel(showResult ? "Result" : "Source");
        if (baseVideoRef.current)
          baseVideoRef.current.style.visibility = showResult ? "hidden" : "visible";
        if (overlayVideoRef.current)
          overlayVideoRef.current.style.visibility = showResult ? "visible" : "hidden";
      }, 400);
      return () => {
        if (flickerTimerRef.current) clearInterval(flickerTimerRef.current);
        // Reset visibility when leaving flicker mode
        if (baseVideoRef.current) baseVideoRef.current.style.visibility = "";
        if (overlayVideoRef.current) overlayVideoRef.current.style.visibility = "";
      };
    }
    // Reset visibility when entering a non-flicker mode
    if (diff.mode !== "flicker") {
      if (baseVideoRef.current) baseVideoRef.current.style.visibility = "";
      if (overlayVideoRef.current) overlayVideoRef.current.style.visibility = "";
    }
  }, [diff.mode, previewFrames.sourceURL, previewFrames.targetURL]);

  // Difference canvas rendering
  useEffect(() => {
    if (diff.mode !== "difference") return;
    const canvas = diffCanvasRef.current;
    const baseEl = baseVideoRef.current;
    const overlayEl = overlayVideoRef.current;
    if (!canvas || !baseEl || !overlayEl) return;
    const b = baseEl;
    const o = overlayEl;

    function draw() {
      const w = Math.min(960, b.videoWidth || 640);
      const h = Math.round(w * ((b.videoHeight || 360) / (b.videoWidth || 640)));
      if (w === 0 || h === 0) return;
      canvas!.width = w;
      canvas!.height = h;
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(b, 0, 0, w, h);
      const a = ctx.getImageData(0, 0, w, h);
      ctx.drawImage(o, 0, 0, w, h);
      const bb = ctx.getImageData(0, 0, w, h);
      const out = ctx.createImageData(w, h);
      for (let i = 0; i < a.data.length; i += 4) {
        out.data[i] = Math.abs(a.data[i] - bb.data[i]);
        out.data[i + 1] = Math.abs(a.data[i + 1] - bb.data[i + 1]);
        out.data[i + 2] = Math.abs(a.data[i + 2] - bb.data[i + 2]);
        out.data[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
    }

    let attempts = 0;
    function tryDraw() {
      if (b.readyState >= 2 && o.readyState >= 2) {
        draw();
        return;
      }
      if (++attempts > 30) return;
      setTimeout(tryDraw, 50);
    }
    tryDraw();
  }, [diff.mode, previewFrames.sourceURL, previewFrames.targetURL]);

  // Divider drag
  const draggingRef = useRef(false);
  useEffect(() => {
    const moveDrag = (clientX: number) => {
      if (!draggingRef.current) return;
      const rect = diffStageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = clampNum(((clientX - rect.left) / rect.width) * 100, 0, 100);
      useStore.setState((s) => ({ diff: { ...s.diff, dividerPct: pct } }));
      if (overlayVideoRef.current)
        overlayVideoRef.current.style.clipPath = `inset(0 0 0 ${pct}%)`;
      if (handleRef.current) handleRef.current.style.left = `${pct}%`;
    };
    const onMove = (e: MouseEvent) => moveDrag(e.clientX);
    const onTouchMove = (e: TouchEvent) => moveDrag(e.touches[0].clientX);
    const onUp = () => { draggingRef.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("touchmove", onTouchMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
    };
  }, []);

  // Magnifier
  const lastLensPos = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const stage = diffStageRef.current;
    if (!stage) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!diffRef.current.magnifier) return;
      const rect = stage.getBoundingClientRect();
      let cx: number, cy: number;
      if ("touches" in e) {
        cx = e.touches[0].clientX - rect.left;
        cy = e.touches[0].clientY - rect.top;
      } else {
        cx = e.clientX - rect.left;
        cy = e.clientY - rect.top;
      }
      lastLensPos.current = { x: cx, y: cy };
      positionLens(cx, cy, rect, magnifierShowsTargetRef.current, magnifierZoomRef.current);
    };
    const onWheel = (e: WheelEvent) => {
      if (!diffRef.current.magnifier) return;
      e.preventDefault();
      const z = magnifierZoomRef.current;
      const next = clampNum(z + (e.deltaY < 0 ? 0.4 : -0.4), 1.5, 8);
      setMagnifierZoom(next);
      positionLens(lastLensPos.current.x, lastLensPos.current.y, stage.getBoundingClientRect(), magnifierShowsTargetRef.current, next);
    };
    const onClick = (e: MouseEvent) => {
      if (!diffRef.current.magnifier) return;
      if ((e.target as HTMLElement)?.closest(".diff-handle")) return;
      const next = !magnifierShowsTargetRef.current;
      setMagnifierShowsTarget(next);
      const rect = stage.getBoundingClientRect();
      positionLens(lastLensPos.current.x, lastLensPos.current.y, rect, next, magnifierZoomRef.current);
    };
    const onLeave = () => {
      if (lensRef.current) lensRef.current.hidden = true;
    };
    stage.addEventListener("mousemove", onMove);
    stage.addEventListener("touchmove", onMove, { passive: true });
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("click", onClick);
    stage.addEventListener("mouseleave", onLeave);
    return () => {
      stage.removeEventListener("mousemove", onMove);
      stage.removeEventListener("touchmove", onMove);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("click", onClick);
      stage.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const positionLens = (x: number, y: number, rect: DOMRect, showsTarget: boolean, zoom: number) => {
    const lens = lensRef.current;
    if (!lens) return;
    const size = 190;
    lens.style.width = `${size}px`;
    lens.style.height = `${size}px`;
    lens.style.left = `${x - size / 2}px`;
    lens.style.top = `${y - size / 2}px`;
    const activeEl = showsTarget ? overlayVideoRef.current : baseVideoRef.current;
    if (activeEl && activeEl.videoWidth) {
      const fc = document.createElement("canvas");
      fc.width = activeEl.videoWidth;
      fc.height = activeEl.videoHeight;
      fc.getContext("2d")!.drawImage(activeEl, 0, 0);
      lens.style.backgroundImage = `url(${fc.toDataURL()})`;
    } else {
      const activeURL = showsTarget ? previewFramesRef.current.targetURL : previewFramesRef.current.sourceURL;
      lens.style.backgroundImage = activeURL ? `url(${activeURL})` : "none";
    }
    lens.style.backgroundSize = `${rect.width * zoom}px ${rect.height * zoom}px`;
    lens.style.backgroundPosition = `${-(x * zoom - size / 2)}px ${-(y * zoom - size / 2)}px`;
    lens.hidden = false;
  };

  // Keyboard shortcuts — use refs, never re-create
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const activeTab = useStore.getState().activeTab;
      if (activeTab !== "preview") return;
      const tag = (document.activeElement as HTMLElement)?.tagName || "";
      if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
      if (e.key === "ArrowRight") {
        const fps = subjectMetaRef.current.fps > 0 ? subjectMetaRef.current.fps : 25;
        const t = previewTimeRef.current + (1 / fps);
        useStore.getState().setPreviewTime(clampNum(t, 0, subjectMetaRef.current.duration || t));
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        const fps = subjectMetaRef.current.fps > 0 ? subjectMetaRef.current.fps : 25;
        const t = previewTimeRef.current - (1 / fps);
        useStore.getState().setPreviewTime(clampNum(t, 0, subjectMetaRef.current.duration || t));
        e.preventDefault();
      } else if (e.key === " ") {
        togglePlay();
        e.preventDefault();
      } else if (e.key === "[") {
        useStore.setState((s) => ({ diff: { ...s.diff, syncOffset: s.diff.syncOffset - 33 } }));
        e.preventDefault();
      } else if (e.key === "]") {
        useStore.setState((s) => ({ diff: { ...s.diff, syncOffset: s.diff.syncOffset + 33 } }));
        e.preventDefault();
      } else if (e.key.toLowerCase() === "s") {
        useStore.setState((s) => ({ diff: { ...s.diff, overlayIsTarget: !s.diff.overlayIsTarget } }));
      } else if (e.key.toLowerCase() === "f") {
        const d = diffRef.current.mode;
        const target = d === "side-by-side"
          ? document.querySelector(".diff-sbs")
          : d === "difference" ? diffCanvasRef.current : diffStageRef.current;
        (target as HTMLElement)?.requestFullscreen?.().catch(() => {});
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [togglePlay]);

  const stepFrame = useCallback((delta: number) => {
    const fps = subjectMetaRef.current.fps > 0 ? subjectMetaRef.current.fps : 25;
    const t = previewTimeRef.current + delta * (1 / fps);
    useStore.getState().setPreviewTime(clampNum(t, 0, subjectMetaRef.current.duration || t));
  }, []);

  const thumbSourceMode = useStore((s) => s.thumbSourceMode);

  const generateScreenlist = useCallback(async () => {
    const s = useStore.getState();
    const src = s.source;
    const dur = subjectMetaRef.current.duration;
    if (!dur || dur <= 0) { toast("No source loaded"); return; }
    setThumbGenerating(true);
    try {
      const count = thumbCount;
      const cols = thumbCols;
      const size = thumbScale;
      const rows = Math.ceil(count / cols);
      const padding = 4;
      const labelH = 22;
      const cw = size;
      const ch = Math.round(size * 9 / 16);
      const canvasW = cols * cw + (cols + 1) * padding;
      const canvasH = rows * (ch + labelH) + (rows + 1) * padding;

      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#1b222b";
      ctx.fillRect(0, 0, canvasW, canvasH);

      const isSource = thumbSourceMode === "source";
      const times = Array.from({ length: count }, (_, i) => (i / (count - 1)) * dur * 0.98);

      for (let i = 0; i < count; i++) {
        const t = times[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = padding + col * (cw + padding);
        const y = padding + row * (ch + labelH + padding);

        let url: string;
        if (isSource) {
          url = await loadFrameOrClip(
            `/api/frame?path=${encodeURIComponent(src!.path)}&time=${t}&width=${cw}`,
          );
        } else {
          url = await loadFrameOrClipPost("/api/preview/frame", {
            input: src!.path,
            time: t,
            width: cw,
            spec: s.settings,
          });
        }

        const img = await loadImage(url);
        ctx.drawImage(img, x, y, cw, ch);

        ctx.fillStyle = "#222b35";
        ctx.fillRect(x, y + ch, cw, labelH);
        ctx.fillStyle = "#93a2b2";
        ctx.font = "11px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(formatPreciseTime(t), x + cw / 2, y + ch + 15);
      }

      if (thumbOutput) URL.revokeObjectURL(thumbOutput);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) { toast("Failed to render"); return; }
      const objURL = URL.createObjectURL(blob);
      setThumbOutput(objURL);
    } catch (err: unknown) {
      toast((err as Error).message);
    } finally {
      setThumbGenerating(false);
    }
  }, [thumbCount, thumbCols, thumbScale, thumbOutput, thumbSourceMode]);

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
              onClick={() => useStore.getState().setPreviewJobId(null)}
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
            onChange={(e) => useStore.getState().setPreviewTime(Number(e.target.value) || 0)}
          />
        </label>
      </div>
      <div className="toolbar">
        <button className="btn btn-quiet" onClick={() => stepFrame(-1)}>
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
              if (!parts.some(isNaN)) useStore.getState().setPreviewTime(parts.reduce((a, n) => a * 60 + n, 0));
            }}
            placeholder="0:00.00"
          />
        </label>
        <button className="btn btn-quiet" onClick={() => stepFrame(1)}>
          Frame {"\u27e9"}
        </button>
        <button
          className="btn btn-quiet"
          onClick={() => useStore.getState().setPreviewTime(settings.trim.start || 0)}
        >
          Trim start
        </button>
        <button
          className="btn btn-quiet"
          onClick={() => useStore.getState().setPreviewTime(subjectMeta.duration / 2 || 0)}
        >
          Middle
        </button>
        <button
          className="btn btn-quiet"
          onClick={() => {
            const t = settings.trim.enabled && settings.trim.end > 0 ? settings.trim.end : subjectMeta.duration;
            useStore.getState().setPreviewTime(t);
          }}
        >
          Trim end
        </button>
        <span className="spacer" />
        <label className="field">
          <span>Duration</span>
          <select
            value={previewDur}
            onChange={(e) => useStore.getState().setPreviewDur(Number(e.target.value) || 0.5)}
          >
            <option value={0.25}>0.25s</option>
            <option value={0.5}>0.5s</option>
            <option value={1}>1s</option>
            <option value={2}>2s</option>
          </select>
        </label>
        <button className="btn" onClick={loadDiffFrames}>
          Refresh frames
        </button>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Comparison mode">
          {(["split", "side-by-side", "overlay", "difference", "flicker"] as const).map((mode) => (
            <button
              key={mode}
              className={`seg${diff.mode === mode ? " is-active" : ""}`}
              onClick={() => useStore.getState().setDiffMode(mode)}
            >
              {mode === "side-by-side" ? "Side by side" : mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
        <button
          className="btn btn-quiet"
          onClick={() => useStore.setState((s) => ({ diff: { ...s.diff, overlayIsTarget: !s.diff.overlayIsTarget } }))}
          title="Swap source/target (S)"
        >
          Swap
        </button>
        <button className="btn" onClick={togglePlay}>
          {diff.playing ? "\u23f8 Pause" : "\u25b6 Play"}
        </button>
        <label className="field sync-field">
          <span>
            Sync offset <em className="hint">{diff.syncOffset}ms</em>
          </span>
          <input
            type="range"
            min={-500}
            max={500}
            value={diff.syncOffset}
            step={10}
            onChange={(e) => {
              useStore.setState((s) => ({ diff: { ...s.diff, syncOffset: Number(e.target.value) } }));
            }}
          />
        </label>
        <span className="spacer" />
        <label className="field check" id="diff-magnifier-field">
          <input
            type="checkbox"
            checked={diff.magnifier}
            onChange={(e) => {
              useStore.setState((s) => ({ diff: { ...s.diff, magnifier: e.target.checked } }));
              if (!e.target.checked && lensRef.current) lensRef.current.hidden = true;
            }}
          />
          <span>Magnifier — click to switch, scroll to zoom</span>
        </label>
        {diff.magnifier && (
          <span className="diff-mag-label">
            Viewing: {magnifierShowsTarget ? "Result" : "Source"}
          </span>
        )}
        <button
          className="btn btn-quiet"
          onClick={() => {
            const target = diff.mode === "side-by-side"
              ? document.querySelector(".diff-sbs")
              : diff.mode === "difference" ? diffCanvasRef.current : diffStageRef.current;
            (target as HTMLElement)?.requestFullscreen?.().catch((err: unknown) => toast((err as Error).message));
          }}
          title="Fullscreen (F)"
        >
          Fullscreen
        </button>
      </div>

      {diff.mode === "overlay" && (
        <label className="field field-wide" id="diff-opacity-field">
          <span>
            Overlay opacity <em className="hint">{diff.opacity}%</em>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={diff.opacity}
            onChange={(e) => {
              const v = Number(e.target.value);
              useStore.setState((s) => ({ diff: { ...s.diff, opacity: v } }));
              if (overlayVideoRef.current) overlayVideoRef.current.style.opacity = String(v / 100);
            }}
          />
        </label>
      )}

      {diff.mode !== "side-by-side" ? (
        <div ref={diffStageRef} className="diff-stage">
          {!hasFrames && (
            <p className="diff-empty">
              Pick a source, then move the timeline to load a frame from the source and the result.
            </p>
          )}
          {hasFrames && diff.mode === "split" && (
            <>
              <span className="original-label" style={{ left: "8px" }}>Source</span>
              <span className="result-label" style={{ right: "8px" }}>Result</span>
            </>
          )}
          {hasFrames && diff.mode === "overlay" && (
            <span className="overlay-info-label">
              Source (behind) / Result (front, {diff.opacity}%)
            </span>
          )}
          {hasFrames && diff.mode === "flicker" && (
            <span className="flicker-label">
              Showing: {flickerLabel}
            </span>
          )}
          {hasFrames && diff.mode === "difference" && (
            <span className="diff-info-label">
              Source vs Result — pixel difference
            </span>
          )}
          {hasFrames && (
            <>
              <video
                ref={baseVideoRef}
                className="diff-img"
                muted
                playsInline
                loop
                hidden={!stacked}
                src={previewFrames.sourceURL || ""}
              />
              <video
                ref={overlayVideoRef}
                className="diff-img"
                muted
                playsInline
                loop
                hidden={!stacked}
                src={previewFrames.targetURL || ""}
                style={{
                  opacity: diff.mode === "overlay" ? diff.opacity / 100 : 1,
                  clipPath: diff.mode === "split" ? `inset(0 0 0 ${diff.dividerPct}%)` : "inset(0)",
                  visibility: diff.mode === "difference" ? "hidden" : undefined,
                }}
              />
            </>
          )}
          {diff.mode === "split" && hasFrames && (
            <div
              ref={handleRef}
              className="diff-handle"
              style={{ left: `${diff.dividerPct}%` }}
              onMouseDown={() => { draggingRef.current = true; }}
              onTouchStart={() => { draggingRef.current = true; }}
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
            <video ref={sbsSourceRef} muted playsInline loop src={previewFrames.sourceURL || ""} />
            <figcaption>Source</figcaption>
          </figure>
          <figure>
            <video ref={sbsTargetRef} muted playsInline loop src={previewFrames.targetURL || ""} />
            <figcaption>Result</figcaption>
          </figure>
        </div>
      )}

      <p className="note" id="diff-note">
        {previewFrames.targetIsFinal
          ? "The result clip is from the actual encoded file."
          : "The result clip is a live preview of the current settings \u2014 actual compression will look slightly softer."}
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
          Download result
        </button>
        {diff.mode === "difference" && (
          <button
            className="btn btn-small btn-quiet"
            onClick={() => {
              diffCanvasRef.current?.toBlob((blob) => {
                if (!blob) { toast("Nothing to download yet"); return; }
                const url = URL.createObjectURL(blob);
                downloadURL(url, `difference-${frameFileStamp(previewFrames.time)}.png`);
                setTimeout(() => URL.revokeObjectURL(url), 4000);
              }, "image/png");
            }}
          >
            Download difference
          </button>
        )}
      </div>

      <h3 className="group-title">Screenlist Generator</h3>
      <div className="toolbar thumb-toolbar">
        <div className="segmented" role="group" aria-label="Frame source">
          <button
            className={`seg${useStore.getState().thumbSourceMode === "source" ? " is-active" : ""}`}
            onClick={() => useStore.getState().setThumbSourceMode("source")}
          >
            Source
          </button>
          <button
            className={`seg${useStore.getState().thumbSourceMode === "target" ? " is-active" : ""}`}
            onClick={() => useStore.getState().setThumbSourceMode("target")}
          >
            Result
          </button>
        </div>
        <label className="field">
          <span>How many</span>
          <input type="number" min={2} max={36} value={thumbCount} onChange={(e) => setThumbCount(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Columns</span>
          <input type="number" min={2} max={8} value={thumbCols} onChange={(e) => setThumbCols(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Size (px)</span>
          <input type="number" min={80} max={640} step={20} value={thumbScale} onChange={(e) => setThumbScale(Number(e.target.value))} />
        </label>
        <button className="btn" onClick={generateScreenlist} disabled={thumbGenerating || !subjectMeta.duration}>
          {thumbGenerating ? "Generating…" : "Generate"}
        </button>
        {thumbOutput && (
          <button
            className="btn btn-quiet"
            onClick={() => { const a = document.createElement("a"); a.href = thumbOutput; a.download = "screenlist.png"; a.click(); }}
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
  if (!url) { toast("No frame loaded yet"); return; }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}