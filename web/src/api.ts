import type { BrowseResponse, MediaInfo, PreviewCommand, Preset, ScanResponse, Spec } from "./types";
import { useApiMonitor } from "./store/apiMonitor";

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

// Track active API calls for monitoring
export interface ApiCallInfo {
  id: string;
  path: string;
  method: string;
  startTime: number;
}

const activeCalls = new Map<string, ApiCallInfo>();
let callIdCounter = 0;

function generateCallId(): string {
  return `api-${++callIdCounter}-${Date.now()}`;
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const callId = generateCallId();
  const method = (options.method || "GET").toUpperCase();
  
  // Track the call as active
  activeCalls.set(callId, { id: callId, path, method, startTime: Date.now() });
  useApiMonitor.getState().addCall(path, method);
  
  try {
    const res = await fetch(path, {
      headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
      ...options,
    });
    
    if (res.status === 204) {
      activeCalls.delete(callId);
      useApiMonitor.getState().completeCall(callId, "success");
      return null as T;
    }
    
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    
    if (!res.ok) {
      const errorMsg = (data && data.error) || `request failed (${res.status})`;
      const error = new ApiError(errorMsg, (data && data.code) || "");
      
      // Show toast for API errors
      toast(`API error: ${errorMsg}`, false);
      
      activeCalls.delete(callId);
      useApiMonitor.getState().completeCall(callId, "error", errorMsg);
      throw error;
    }
    
    activeCalls.delete(callId);
    useApiMonitor.getState().completeCall(callId, "success");
    return data as T;
  } catch (err) {
    // Network errors or other non-API errors
    if (err instanceof ApiError) {
      throw err; // Already handled above
    }
    
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    toast(`API error: ${errorMsg}`, false);
    
    activeCalls.delete(callId);
    useApiMonitor.getState().completeCall(callId, "error", errorMsg);
    throw err;
  }
}

// Get currently active API calls (for monitoring UI)
export function getActiveApiCalls(): ApiCallInfo[] {
  return Array.from(activeCalls.values());
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
