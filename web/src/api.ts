import type { BrowseResponse, MediaInfo, PreviewCommand, Preset, ScanResponse, Spec } from "./types";
import { useApiMonitor } from "./store/apiMonitor";

// ApiError carries the server's own reason code, so a caller can tell one kind
// of refusal from another — queueing a name that is already taken, for one.
// The HTTP status travels along for callers that only care about the class of
// failure (a 409 conflict, say).
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

interface ErrorPayload {
  error?: string;
  code?: string;
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();

  // The monitor store mints the id — completing the call has to use the same
  // one, or the entry is stuck in "running" forever.
  const callId = useApiMonitor.getState().addCall(path, method);
  const monitor = () => useApiMonitor.getState();

  try {
    const res = await fetch(path, {
      headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
      ...options,
    });

    if (res.status === 204) {
      monitor().completeCall(callId, "success");
      return null as T;
    }

    const text = await res.text();
    let data: ErrorPayload | null = null;
    let plainBody = false;
    if (text) {
      // A non-JSON body (a proxy page, basic-auth text) must still come back
      // as an ApiError, or every caller's structured handling silently
      // degrades to a generic failure.
      try {
        const parsed: unknown = JSON.parse(text);
        data = typeof parsed === "object" && parsed !== null ? (parsed as ErrorPayload) : null;
      } catch {
        plainBody = true;
      }
    }

    if (!res.ok) {
      const errorMsg =
        (data && data.error) ||
        (plainBody && text.trim() ? text.trim().slice(0, 200) : `request failed (${res.status})`);
      const code = (data && data.code) || "";
      const error = new ApiError(errorMsg, code, res.status);

      // Record the failure before anything else: a throwing toast handler
      // must never leave the call stuck as "running" in the monitor.
      monitor().completeCall(callId, "error", errorMsg);

      // Conflicts the UI turns into a replace/cancel question belong to the
      // caller — reporting them as an error here would tell the user the
      // request failed before they have decided what to do about it.
      if (!code.startsWith("output-")) {
        toast(`API error: ${errorMsg}`, false);
      }

      throw error;
    }

    monitor().completeCall(callId, "success");
    return data as T;
  } catch (err) {
    // Network errors or other non-API errors. An ApiError was already marked
    // failed on its way out above, so only everything else lands here.
    if (!(err instanceof ApiError)) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      monitor().completeCall(callId, "error", errorMsg);
      toast(`API error: ${errorMsg}`, false);
    }
    throw err;
  }
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
  // Registering `toast` itself would call its own handler, i.e. itself,
  // forever — the renderer owns the handler and nothing else may take it.
  if (fn === toast) return;
  toastFn = fn;
}

export function toast(message: string, ok = false) {
  try {
    if (toastFn) toastFn(message, ok);
  } catch {
    // A broken handler must not take down the caller reporting the failure.
  }
}
