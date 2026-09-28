import type { BrowseResponse, MediaInfo, PreviewCommand, Preset, ScanResponse, Spec } from "./types";

// ApiError carries the server's own reason code, so a caller can tell one kind
// of refusal from another — queueing a name that is already taken, for one.
export class ApiError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return null as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(
      (data && data.error) || `request failed (${res.status})`,
      (data && data.code) || "",
    );
  }
  return data as T;
}

export async function browse(path: string, kind: "video" | "audio" | "subtitle" = "video"): Promise<BrowseResponse> {
  return api(`/api/browse?path=${encodeURIComponent(path)}&kind=${kind}`);
}

export async function probe(path: string): Promise<MediaInfo> {
  return api("/api/probe", { method: "POST", body: JSON.stringify({ path }) });
}

export async function upload(file: File): Promise<MediaInfo> {
  const body = new FormData();
  body.append("file", file);
  return api("/api/upload", { method: "POST", body });
}

export async function scan(dir: string, recursive: boolean): Promise<ScanResponse> {
  return api(`/api/scan?path=${encodeURIComponent(dir)}&recursive=${recursive}`);
}

export async function previewCommand(spec: Spec): Promise<PreviewCommand> {
  return api("/api/preview", { method: "POST", body: JSON.stringify(spec) });
}

export async function savePreset(
  preset: Pick<Preset, "name" | "group" | "note"> & { settings: Spec },
): Promise<Preset[]> {
  return api("/api/presets", { method: "POST", body: JSON.stringify(preset) });
}

export async function deletePreset(name: string): Promise<Preset[]> {
  return api(`/api/presets/${encodeURIComponent(name)}`, { method: "DELETE" });
}

let toastFn: ((msg: string, ok?: boolean) => void) | null = null;

export function setToastHandler(fn: (msg: string, ok?: boolean) => void) {
  toastFn = fn;
}

export function toast(message: string, ok = false) {
  if (toastFn) toastFn(message, ok);
}
