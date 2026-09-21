import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { clampNum, formatPreciseTime, loadFrameOrClip } from "../utils";

// How long a handle has to be held before the frame tooltip appears, and how
// long we wait between frame requests while it is being dragged.
const HOLD_MS = 500;
const FRAME_DEBOUNCE_MS = 250;
const MIN_GAP = 0.2;

function frameURL(path: string, t: number, width: number): string {
  return `/api/frame?path=${encodeURIComponent(path)}&time=${Math.max(0, t)}&width=${width}`;
}

/**
 * TrimRange is the two-handle range picker used for trimming. It mirrors
 * settings.trim, shows the first and last frame of the picked range, and while
 * a handle is held down for half a second it shows the source frame under it so
 * the user can see what they are cutting to.
 */
export function TrimRange() {
  const source = useStore((s) => s.source);
  const trim = useStore((s) => s.settings.trim);
  const updateSettings = useStore((s) => s.updateSettings);

  const duration = source?.duration || 0;
  const path = source?.path ?? null;
  const start = Math.min(trim.start, Math.max(0, duration));
  const end = trim.end > 0 ? Math.min(trim.end, duration) : duration;

  // The edge frames belong to one file, so they are stored with the key of the
  // file they came from; a new file simply stops matching and shows empty
  // placeholders until its own frames arrive.
  const framesKey = `${path ?? ""}|${duration}`;
  const [frames, setFrames] = useState<{
    key: string;
    start: string | null;
    end: string | null;
  }>({ key: "", start: null, end: null });
  const [held, setHeld] = useState<"start" | "end" | null>(null);
  const [tipFrame, setTipFrame] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Beginning and end frames, refreshed a beat after the handles settle.
  useEffect(() => {
    if (!path || duration <= 0) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const [a, b] = await Promise.all([
          loadFrameOrClip(frameURL(path, start, 240)),
          loadFrameOrClip(frameURL(path, end, 240)),
        ]);
        if (!live) return;
        setFrames({ key: framesKey, start: a, end: b });
        setFailed(false);
      } catch {
        if (live) setFailed(true);
      }
    }, FRAME_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, duration, start, end, framesKey]);

  // While a handle is held, keep the tooltip frame in step with it.
  useEffect(() => {
    if (!held || !path) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {          const url = await loadFrameOrClip(frameURL(path, held === "start" ? start : end, 200));
        if (live) setTipFrame(url);
      } catch {
        /* keep whatever frame is already showing */
      }
    }, FRAME_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [held, path, start, end]);

  const beginHold = (which: "start" | "end") => {
    clearTimeout(holdTimer.current);
    setHeld(null);
    holdTimer.current = setTimeout(() => {
      setTipFrame(null);
      setHeld(which);
    }, HOLD_MS);
  };

  const endHold = () => {
    clearTimeout(holdTimer.current);
    setHeld(null);
    setTipFrame(null);
  };

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const pick = (which: "start" | "end", raw: number) => {
    if (duration <= 0) return;
    const v = clampNum(raw, 0, duration);
    if (which === "start") {
      updateSettings("trim.start", Math.round(Math.min(v, end - MIN_GAP) * 10) / 10);
    } else {
      updateSettings("trim.end", Math.round(Math.max(v, start + MIN_GAP) * 10) / 10);
    }
    if (!trim.enabled) updateSettings("trim.enabled", true);
  };

  if (!source) {
    return (
      <p className="note">
        Pick a source file and the beginning and end frames show up here.
      </p>
    );
  }

  const pct = (t: number) => (duration > 0 ? clampNum((t / duration) * 100, 0, 100) : 0);
  const tipAt = held ? (held === "start" ? start : end) : 0;
  const shown = frames.key === framesKey ? frames : { start: null, end: null };

  return (
    <div className="trim-range">
      <div className="dual-range">
        <div className="dual-track" />
        <div
          className="dual-fill"
          style={{ left: `${pct(start)}%`, width: `${Math.max(0, pct(end) - pct(start))}%` }}
        />
        <input
          type="range"
          className="dual-input"
          min={0}
          max={duration || 1}
          step={0.1}
          value={start}
          style={{ zIndex: start > duration / 2 ? 5 : 3 }}
          onChange={(e) => pick("start", Number(e.target.value))}
          onPointerDown={() => beginHold("start")}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onBlur={endHold}
          aria-label="Trim start"
        />
        <input
          type="range"
          className="dual-input"
          min={0}
          max={duration || 1}
          step={0.1}
          value={end}
          style={{ zIndex: end < duration / 2 ? 5 : 3 }}
          onChange={(e) => pick("end", Number(e.target.value))}
          onPointerDown={() => beginHold("end")}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onBlur={endHold}
          aria-label="Trim end"
        />
        {held && tipFrame && (
          <div
            className="trim-tip"
            style={{ left: `${pct(tipAt)}%` }}
          >
            <img src={tipFrame} alt="" />
            <span>{formatPreciseTime(tipAt)}</span>
          </div>
        )}
      </div>

      <div className="trim-legend">
        <span>Beginning {formatPreciseTime(start)}</span>
        <span>
          Keep {formatPreciseTime(Math.max(0, end - start))} of{" "}
          {formatPreciseTime(duration)}
        </span>
        <span>End {formatPreciseTime(end)}</span>
      </div>

      <div className="trim-frames">
        <figure>
          {shown.start ? (
            <img src={shown.start} alt="Frame at the beginning of the range" />
          ) : (
            <div className="trim-frame-empty" />
          )}
          <figcaption>Beginning</figcaption>
        </figure>
        <figure>
          {shown.end ? (
            <img src={shown.end} alt="Frame at the end of the range" />
          ) : (
            <div className="trim-frame-empty" />
          )}
          <figcaption>End</figcaption>
        </figure>
        {held && !tipFrame && !failed && (
          <p className="trim-hint">Loading a frame from the source file…</p>
        )}
      </div>
    </div>
  );
}
