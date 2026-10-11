import { toast } from "./api";

// Desktop + sound alerts for finished encodes.
//
// Browsers gate both notifications and audio behind a user gesture, so
// permission is requested lazily from the toolbar toggle rather than on load.
// Everything here degrades quietly: no Notification support, a denied prompt,
// or a blocked AudioContext each just drop that half of the alert.

const STORE_KEY = "ffmpeg-web.notifyOnDone";

export function loadNotifyOnDone(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveNotifyOnDone(v: boolean): void {
  try {
    if (v) localStorage.setItem(STORE_KEY, "1");
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode — the setting just won't persist */
  }
}

export function notificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

/** Called from a click, so the browser lets the prompt and audio both start. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

// ---- sound ----

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    // The first ever beep may land before a gesture; resume is a no-op otherwise.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function beep(freqs: number[], delay = 0, dur = 0.18, gain = 0.18): void {
  const ac = audioCtx();
  if (!ac) return;
  freqs.forEach((freq, i) => {
    const t0 = ac.currentTime + delay + i * dur;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(ac.destination);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  });
}

export function playDoneSound(ok: boolean): void {
  if (ok) beep([659.25, 880]); // rising major third
  else beep([311.13, 233.08], 0, 0.24, 0.2); // falling, darker
}

// ---- the alert itself ----

export function notifyJobFinished(job: { id: string; label: string; status: string; error?: string }): void {
  const ok = job.status === "done";
  playDoneSound(ok);

  const title = ok ? "Encode finished" : "Encode failed";
  const body = ok
    ? `${job.label} is done`
    : `${job.label}${job.error ? " — " + job.error : ""}`;

  if (notificationsSupported() && Notification.permission === "granted") {
    try {
      const n = new Notification(title, { body, tag: job.id });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      toast(body, ok);
    }
    return;
  }
  // No notification available — fall back to the in-app toast.
  toast(body, ok);
}
