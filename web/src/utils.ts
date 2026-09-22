import type { EncoderCatalog, EncoderLibrary } from "./types";

export function formatBytes(n: number): string {
  if (!n || n <= 0) return "\u2014";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0 || !isFinite(seconds)) return "\u2014";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (v: number) => String(v).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function parseTimecode(text: string): number {
  const raw = String(text || "").trim();
  if (!raw) return 0;
  const parts = raw.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatPreciseTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export function baseName(p: string): string {
  return String(p || "").split(/[\\/]/).pop() || "";
}

export function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// The last playable instant of a video is one frame before its reported
// duration; asking for a frame at exactly the end lands behind the last frame
// and ffmpeg returns nothing. This clamps times to just inside the timeline (a
// fixed margin when the frame rate is unknown) so the "last frame" request
// always hits a real frame.
export function seekLimit(duration: number, fps: number): number {
  if (!duration || duration <= 0 || !isFinite(duration)) return 0;
  const margin = fps > 0 ? 1 / fps : 0.1;
  return Math.max(0, duration - Math.min(margin, duration / 2));
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let handle: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  }) as T;
}

export const encoderNames: Record<string, string> = {
  x264: "H.264",
  x265: "H.265",
  vp9: "VP9",
  av1: "AV1",
  copy: "unchanged video",
};

export const qualityScales: Record<string, { max: number; good: number }> = {
  x264: { max: 51, good: 23 },
  x265: { max: 51, good: 26 },
  vp9: { max: 63, good: 31 },
  av1: { max: 63, good: 32 },
};

// The codec family behind each entry of the encoder picker. The backend uses
// the same mapping to group its encoder library catalog.
export const codecForEncoder: Record<string, string> = {
  x264: "h264",
  x265: "hevc",
  vp9: "vp9",
  av1: "av1",
};

export function librariesForCodec(
  catalog: EncoderCatalog,
  codec: string,
): EncoderLibrary[] {
  return catalog.libraries.filter((l) => l.codec === codec);
}

export function frameFileStamp(t: number): string {
  return formatPreciseTime(t).replace(":", "m").replace(".", "s");
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

export async function loadFrameOrClip(url: string): Promise<string> {
  const cached = frameCacheGet(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch {}
    throw new Error(msg || `request failed (${res.status})`);
  }
  const objURL = URL.createObjectURL(await res.blob());
  frameCacheSet(url, objURL);
  return objURL;
}
