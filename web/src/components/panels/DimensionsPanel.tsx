import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import {
  clampNum,
  formatDuration,
  formatPreciseTime,
  loadFrameOrClip,
  seekLimit,
} from "../../utils";

type CropRect = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type Drag =
  | { mode: "move"; from: CropRect; sx: number; sy: number; last: CropRect }
  | { mode: "draw"; from: CropRect; sx: number; sy: number; last: CropRect }
  | { mode: Handle; from: CropRect; sx: number; sy: number; last: CropRect };

const MIN_KEEP = 2;
const FRAME_W = 1280;
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function storeCropRect(
  pic: { cropLeft: number; cropTop: number; cropRight: number; cropBottom: number },
  srcW: number,
  srcH: number,
): CropRect {
  const x = clampNum(pic.cropLeft, 0, srcW);
  const y = clampNum(pic.cropTop, 0, srcH);
  return {
    x,
    y,
    w: clampNum(srcW - pic.cropLeft - pic.cropRight, MIN_KEEP, srcW),
    h: clampNum(srcH - pic.cropTop - pic.cropBottom, MIN_KEEP, srcH),
  };
}

function drawRect(sx: number, sy: number, px: number, py: number, srcW: number, srcH: number): CropRect {
  const x = clampNum(Math.min(sx, px), 0, srcW - MIN_KEEP);
  const w = clampNum(Math.abs(px - sx), MIN_KEEP, srcW - x);
  const y = clampNum(Math.min(sy, py), 0, srcH - MIN_KEEP);
  const h = clampNum(Math.abs(py - sy), MIN_KEEP, srcH - y);
  return { x, y, w, h };
}

function resizeRect(mode: Handle, from: CropRect, p: { x: number; y: number }, srcW: number, srcH: number): CropRect {
  const px = clampNum(p.x, 0, srcW);
  const py = clampNum(p.y, 0, srcH);
  switch (mode) {
    case "nw":
      return {
        x: clampNum(px, 0, from.x + from.w - MIN_KEEP),
        y: clampNum(py, 0, from.y + from.h - MIN_KEEP),
        w: from.x + from.w - clampNum(px, 0, from.x + from.w - MIN_KEEP),
        h: from.y + from.h - clampNum(py, 0, from.y + from.h - MIN_KEEP),
      };
    case "n":
      return {
        x: from.x,
        y: clampNum(py, 0, from.y + from.h - MIN_KEEP),
        w: from.w,
        h: from.y + from.h - clampNum(py, 0, from.y + from.h - MIN_KEEP),
      };
    case "ne":
      return {
        x: from.x,
        y: clampNum(py, 0, from.y + from.h - MIN_KEEP),
        w: clampNum(px - from.x, MIN_KEEP, srcW - from.x),
        h: from.y + from.h - clampNum(py, 0, from.y + from.h - MIN_KEEP),
      };
    case "e":
      return { x: from.x, y: from.y, w: clampNum(px - from.x, MIN_KEEP, srcW - from.x), h: from.h };
    case "se":
      return {
        x: from.x,
        y: from.y,
        w: clampNum(px - from.x, MIN_KEEP, srcW - from.x),
        h: clampNum(py - from.y, MIN_KEEP, srcH - from.y),
      };
    case "s":
      return { x: from.x, y: from.y, w: from.w, h: clampNum(py - from.y, MIN_KEEP, srcH - from.y) };
    case "sw":
      return {
        x: clampNum(px, 0, from.x + from.w - MIN_KEEP),
        y: from.y,
        w: from.x + from.w - clampNum(px, 0, from.x + from.w - MIN_KEEP),
        h: clampNum(py - from.y, MIN_KEEP, srcH - from.y),
      };
    case "w":
      return {
        x: clampNum(px, 0, from.x + from.w - MIN_KEEP),
        y: from.y,
        w: from.x + from.w - clampNum(px, 0, from.x + from.w - MIN_KEEP),
        h: from.h,
      };
  }
}

export function DimensionsPanel() {
  const source = useStore((s) => s.source);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const previewTime = useStore((s) => s.previewTime);
  const setPreviewTime = useStore((s) => s.setPreviewTime);
  const s = settings;
  const isCustom = s.picture.scaleMode === "custom";

  const srcW = source?.video?.width || 0;
  const srcH = source?.video?.height || 0;
  const fps = source?.video?.fps || 0;
  const duration = source?.duration || 0;
  const limit = seekLimit(duration, fps);
  const pic = s.picture;

  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [live, setLive] = useState<CropRect | null>(null);
  const [frameURL, setFrameURL] = useState<string | null>(null);

  // Keep the shared preview playhead inside this file's timeline.
  useEffect(() => {
    if (duration > 0 && previewTime > limit) setPreviewTime(limit);
  }, [duration, limit, previewTime, setPreviewTime]);

  // Load the source frame the same way the Preview tab does — same endpoint,
  // same cache, same time.
  useEffect(() => {
    if (!settings.input || !srcW) {
      setFrameURL(null);
      return;
    }
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const url = await loadFrameOrClip(
          `/api/frame?path=${encodeURIComponent(settings.input)}&time=${previewTime}&width=${FRAME_W}`,
        );
        if (!stale) setFrameURL(url);
      } catch {
        if (!stale) setFrameURL(null);
      }
    }, 80);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [settings.input, previewTime, srcW]);

  const rect = live ?? storeCropRect(pic, srcW, srcH);
  const rectW = Math.max(0, srcW - pic.cropLeft - pic.cropRight);
  const rectH = Math.max(0, srcH - pic.cropTop - pic.cropBottom);

  const toPoint = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height || !srcW || !srcH) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - r.left) / r.width) * srcW,
      y: ((e.clientY - r.top) / r.height) * srcH,
    };
  };

  const commit = (r: CropRect) => {
    const cw = clampNum(r.w, MIN_KEEP, srcW - r.x);
    const ch = clampNum(r.h, MIN_KEEP, srcH - r.y);
    const x = clampNum(r.x, 0, srcW - cw);
    const y = clampNum(r.y, 0, srcH - ch);
    const even = (v: number) => Math.max(0, Math.round(v / 2) * 2);
    const ex = even(x);
    const ey = even(y);
    const ew = even(cw);
    const eh = even(ch);
    updateSettings("picture.cropLeft", ex);
    updateSettings("picture.cropTop", ey);
    updateSettings("picture.cropRight", srcW - ex - ew);
    updateSettings("picture.cropBottom", srcH - ey - eh);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!srcW || !srcH) return;
    const el = e.target as HTMLElement;
    const handle = el.closest("[data-handle]")?.getAttribute("data-handle") as Handle | null;
    const p = toPoint(e);
    const from = live ?? storeCropRect(pic, srcW, srcH);
    dragRef.current = { mode: handle || (el.closest(".crop-sel") ? "move" : "draw"), from, sx: p.x, sy: p.y, last: from };
    wrapRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toPoint(e);
    let next: CropRect;
    if (d.mode === "move") {
      next = {
        x: clampNum(d.from.x + (p.x - d.sx), 0, srcW - d.from.w),
        y: clampNum(d.from.y + (p.y - d.sy), 0, srcH - d.from.h),
        w: d.from.w,
        h: d.from.h,
      };
    } else if (d.mode === "draw") {
      next = drawRect(d.sx, d.sy, p.x, p.y, srcW, srcH);
    } else {
      next = resizeRect(d.mode, d.from, p, srcW, srcH);
    }
    d.last = next;
    setLive(next);
  };

  const onPointerEnd = () => {
    const d = dragRef.current;
    if (d) commit(d.last);
    dragRef.current = null;
    setLive(null);
  };

  const stepFrame = (delta: number) => {
    const f = fps > 0 ? fps : 25;
    const t = previewTime + delta * (1 / f);
    setPreviewTime(clampNum(t, 0, limit || t));
  };

  const outputDims = (() => {
    if (!source || !source.video) return null;
    let w = srcW - pic.cropLeft - pic.cropRight;
    let h = srcH - pic.cropTop - pic.cropBottom;
    if (w <= 0 || h <= 0) return null;
    if (isCustom && pic.width > 0 && pic.height > 0) {
      if (pic.keepAspect && !pic.pad) {
        const ratio = Math.min(pic.width / w, pic.height / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      } else {
        w = pic.width;
        h = pic.height;
      }
    }
    if (s.filters.rotate % 180 === 90) [w, h] = [h, w];
    return { w: w - (w % 2), h: h - (h % 2) };
  })();

  const pct = (v: number, dim: number) => `${(dim ? (v / dim) * 100 : 0)}%`;

  return (
    <section className="panel is-active">
      <div className="grid">
        <label className="field">
          <span>Size</span>
          <select
            value={s.picture.scaleMode}
            onChange={(e) => updateSettings("picture.scaleMode", e.target.value)}
          >
            <option value="source">Same as source</option>
            <option value="custom">Resize to</option>
          </select>
        </label>
        {isCustom && (
          <>
            <label className="field">
              <span>Width</span>
              <input
                type="number"
                min={16}
                step={2}
                value={s.picture.width}
                onChange={(e) =>
                  updateSettings("picture.width", Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              <span>Height</span>
              <input
                type="number"
                min={16}
                step={2}
                value={s.picture.height}
                onChange={(e) =>
                  updateSettings("picture.height", Number(e.target.value))
                }
              />
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={s.picture.keepAspect}
                onChange={(e) =>
                  updateSettings("picture.keepAspect", e.target.checked)
                }
              />
              <span>Keep the original shape</span>
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={s.picture.pad}
                onChange={(e) => updateSettings("picture.pad", e.target.checked)}
              />
              <span>Fill the leftover space with black bars</span>
            </label>
          </>
        )}
        <label className="field">
          <span>Colour depth</span>
          <select
            value={s.picture.pixelFormat}
            onChange={(e) =>
              updateSettings("picture.pixelFormat", e.target.value)
            }
          >
            <option value="">Same as source</option>
            <option value="yuv420p">8-bit</option>
            <option value="yuv420p10le">10-bit</option>
          </select>
        </label>
      </div>

      <h3 className="group-title">Crop</h3>
      <div className="crop">
        <div
          ref={wrapRef}
          className="crop-visual"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {frameURL ? (
            <img src={frameURL} alt="Source frame" draggable={false} />
          ) : (
            <div className="crop-placeholder">
              {srcW
                ? "Scrub the timeline to load a frame from the source."
                : "This file has no video stream to crop."}
            </div>
          )}
          {srcW && frameURL && (
            <div
              className="crop-sel"
              style={{
                left: pct(rect.x, srcW),
                top: pct(rect.y, srcH),
                width: pct(rect.w, srcW),
                height: pct(rect.h, srcH),
              }}
            >
              {HANDLES.map((h) => (
                <span key={h} className="crop-handle" data-handle={h} />
              ))}
            </div>
          )}
        </div>

        <div className="crop-timeline">
          <button
            className="btn btn-small btn-quiet"
            onClick={() => stepFrame(-1)}
            disabled={!limit}
            title="One frame back"
          >
            {"\u27e8"} Frame
          </button>
          <span className="crop-time">
            {formatPreciseTime(previewTime)}
            <em> / {formatDuration(duration)}</em>
          </span>
          <input
            type="range"
            min={0}
            max={limit}
            step={0.1}
            value={previewTime}
            disabled={!limit}
            onChange={(e) => setPreviewTime(Number(e.target.value) || 0)}
            title="Seek through the source file"
          />
          <button
            className="btn btn-small btn-quiet"
            onClick={() => stepFrame(1)}
            disabled={!limit}
            title="One frame forward"
          >
            Frame {"\u27e9"}
          </button>
        </div>

        <p className="crop-readout">
          Keeping{" "}
          <strong>
            {rect.w}
            {"\u00d7"}
            {rect.h}
          </strong>{" "}
          pixels at ({Math.round(rect.x)}, {Math.round(rect.y)}) from the{" "}
          {srcW}
          {"\u00d7"}
          {srcH} source. Drag the box to move it, resize it from the
          corners or edge handles, or draw a new box on the frame.
        </p>

        <div className="grid">
          <label className="field">
            <span>X</span>
            <input
              type="number"
              min={0}
              step={2}
              max={Math.max(0, srcW - MIN_KEEP)}
              value={pic.cropLeft}
              disabled={!srcW}
              onChange={(e) =>
                updateSettings(
                  "picture.cropLeft",
                  clampNum(Number(e.target.value) || 0, 0, Math.max(0, srcW - MIN_KEEP)),
                )
              }
            />
          </label>
          <label className="field">
            <span>Y</span>
            <input
              type="number"
              min={0}
              step={2}
              max={Math.max(0, srcH - MIN_KEEP)}
              value={pic.cropTop}
              disabled={!srcW}
              onChange={(e) =>
                updateSettings(
                  "picture.cropTop",
                  clampNum(Number(e.target.value) || 0, 0, Math.max(0, srcH - MIN_KEEP)),
                )
              }
            />
          </label>
          <label className="field">
            <span>Kept width</span>
            <input
              type="number"
              min={MIN_KEEP}
              step={2}
              max={Math.max(MIN_KEEP, srcW - pic.cropLeft)}
              value={rectW}
              disabled={!srcW}
              onChange={(e) => {
                const w = clampNum(
                  Number(e.target.value) || MIN_KEEP,
                  MIN_KEEP,
                  Math.max(MIN_KEEP, srcW - pic.cropLeft),
                );
                updateSettings("picture.cropRight", srcW - pic.cropLeft - w);
              }}
            />
          </label>
          <label className="field">
            <span>Kept height</span>
            <input
              type="number"
              min={MIN_KEEP}
              step={2}
              max={Math.max(MIN_KEEP, srcH - pic.cropTop)}
              value={rectH}
              disabled={!srcW}
              onChange={(e) => {
                const h = clampNum(
                  Number(e.target.value) || MIN_KEEP,
                  MIN_KEEP,
                  Math.max(MIN_KEEP, srcH - pic.cropTop),
                );
                updateSettings("picture.cropBottom", srcH - pic.cropTop - h);
              }}
            />
          </label>
          <button
            className="btn btn-small btn-quiet"
            onClick={() => {
              updateSettings("picture.cropLeft", 0);
              updateSettings("picture.cropTop", 0);
              updateSettings("picture.cropRight", 0);
              updateSettings("picture.cropBottom", 0);
            }}
            disabled={!srcW}
          >
            Reset crop
          </button>
        </div>
      </div>
      <p className="note">
        {outputDims
          ? `The finished video will be ${outputDims.w}\u00d7${outputDims.h} pixels.`
          : source
            ? "Those crop values remove the whole picture."
            : ""}
      </p>
    </section>
  );
}