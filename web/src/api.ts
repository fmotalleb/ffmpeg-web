import type { BrowseResponse, MediaInfo, PreviewCommand, ScanResponse, Spec } from "./types";

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return null as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `request failed (${res.status})`);
  return data as T;
}

export async function browse(path: string): Promise<BrowseResponse> {
  return api(`/api/browse?path=${encodeURIComponent(path)}`);
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

let toastFn: ((msg: string, ok?: boolean) => void) | null = null;

export function setToastHandler(fn: (msg: string, ok?: boolean) => void) {
  toastFn = fn;
}

export function toast(message: string, ok = false) {
  if (toastFn) toastFn(message, ok);
}
