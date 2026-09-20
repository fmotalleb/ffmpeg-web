"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  config: { root: "", outDir: "", allowCommands: false },
  source: null,          // MediaInfo for the single-file flow
  presets: [],
  presetId: null,
  settings: defaultSettings(),
  queue: { paused: false, settings: null },
  jobs: new Map(),
  batchDir: null,
  browserDir: null,
  editingJobId: null,
  previewJobId: null,
  previewFrames: { time: 0, sourceURL: null, targetURL: null, targetIsFinal: false },
  diff: {
    overlayIsTarget: true, magnifier: false, magnifierShowsTarget: true,
    dividerPct: 50, mode: "split", opacity: 50, magZoom: 3,
  },
};

function defaultSettings() {
  return {
    input: "",
    outputName: "",
    container: "mp4",
    webOptimize: true,
    video: {
      encoder: "x264", rateMode: "quality", quality: 22, bitrate: 4000,
      twoPass: false, speed: "medium", profile: "auto", level: "auto",
      tune: "none", fpsMode: "same", fps: "30", gop: 0,
    },
    audio: {
      encoder: "aac", track: 0, bitrate: 160, mixdown: "stereo",
      sampleRate: 48000, gain: 0, normalize: false,
    },
    picture: {
      scaleMode: "source", width: 1920, height: 1080, keepAspect: true, pad: false,
      cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0, cropDetect: false,
      pixelFormat: "",
    },
    filters: {
      deinterlace: "off", denoise: "off", sharpen: false, deblock: false,
      rotate: 0, flipH: false, grayscale: false,
    },
    subtitle: { mode: "none", track: 0 },
    trim: { enabled: false, start: 0, end: 0 },
    extra: { encoderOptions: "", inputArgs: "", outputArgs: "" },
  };
}

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

/* ---------- formatting ---------- */

function formatBytes(n) {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0 || !isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (v) => String(v).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function parseTimecode(text) {
  const raw = String(text || "").trim();
  if (!raw) return 0;
  const parts = raw.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const baseName = (p) => String(p || "").split(/[\\/]/).pop();
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function debounce(fn, ms) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- API ---------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, ok = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("ok", ok);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

/* ---------- binding ---------- */

function readControl(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.dataset.type === "number" || el.type === "range" || el.type === "number") {
    return el.value === "" ? 0 : Number(el.value);
  }
  return el.value;
}

function bindInputs() {
  $$("[data-bind]").forEach((el) => {
    const event = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(event, () => {
      setPath(state.settings, el.dataset.bind, readControl(el));
      state.presetId = null;
      render();
    });
  });

  $$(".seg[data-ratemode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.video.rateMode = btn.dataset.ratemode;
      render();
    });
  });

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  $("#trim-start").addEventListener("input", (e) => {
    state.settings.trim.start = parseTimecode(e.target.value);
    render();
  });
  $("#trim-end").addEventListener("input", (e) => {
    state.settings.trim.end = parseTimecode(e.target.value);
    render();
  });
}

function switchTab(name) {
  stopFlicker();
  $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === name));
  if (name === "advanced") refreshCommandPreview();
  if (name === "preview") { renderPreviewSubjectLabel(); refreshPreviewRange(); }
}

function syncInputs() {
  $$("[data-bind]").forEach((el) => {
    const value = getPath(state.settings, el.dataset.bind);
    if (el.type === "checkbox") el.checked = Boolean(value);
    else if (document.activeElement !== el) el.value = value ?? "";
  });
}

function applyVisibility() {
  $$("[data-show]").forEach((el) => {
    const rule = el.dataset.show;
    const negate = rule.includes("!=");
    const [path, want] = rule.split(negate ? "!=" : "=");
    const actual = String(getPath(state.settings, path.trim()) ?? "");
    const matches = actual === want.trim();
    el.classList.toggle("is-hidden", negate ? matches : !matches);
  });
}

/* ---------- quality scale ---------- */

const qualityScales = {
  x264: { max: 51, good: 23 },
  x265: { max: 51, good: 26 },
  vp9: { max: 63, good: 31 },
  av1: { max: 63, good: 32 },
};

function syncQualityScale() {
  const scale = qualityScales[state.settings.video.encoder] || qualityScales.x264;
  const slider = $("#crf");
  slider.max = scale.max;
  if (state.settings.video.quality > scale.max) {
    state.settings.video.quality = scale.good;
    slider.value = scale.good;
  }
  $("#crf-value").textContent = state.settings.video.quality;
  $("#crf-hint").textContent = `— ${scale.good} is a good default for this encoder`;
}

/* ---------- presets ---------- */

async function loadPresets() {
  state.presets = await api("/api/presets");
  const list = $("#preset-list");
  list.innerHTML = "";
  let group = null;
  state.presets.forEach((preset) => {
    if (preset.group !== group) {
      group = preset.group;
      const heading = document.createElement("p");
      heading.className = "preset-group-name";
      heading.textContent = group;
      list.append(heading);
    }
    const btn = document.createElement("button");
    btn.className = "preset";
    btn.dataset.id = preset.id;
    btn.innerHTML = "<strong></strong><span></span>";
    btn.querySelector("strong").textContent = preset.name;
    btn.querySelector("span").textContent = preset.note;
    btn.addEventListener("click", () => applyPreset(preset));
    list.append(btn);
  });
}

function applyPreset(preset) {
  const keepName = state.settings.outputName;
  const keepExtra = state.settings.extra;
  state.settings = { ...defaultSettings(), ...structuredClone(preset.settings) };
  state.settings.outputName = keepName;
  state.settings.extra = keepExtra;
  state.settings.input = state.source ? state.source.path : "";
  state.presetId = preset.id;
  fitToSource();
  render();
}

function fitToSource() {
  const src = state.source;
  const pic = state.settings.picture;
  if (!src || !src.video || pic.scaleMode !== "custom") return;
  if (src.video.width && src.video.width < pic.width && !pic.pad) {
    pic.width = src.video.width;
    pic.height = src.video.height;
  }
  if (src.video.interlaced && state.settings.filters.deinterlace === "off") {
    state.settings.filters.deinterlace = "bwdif";
  }
}

function presetName() {
  const preset = state.presets.find((p) => p.id === state.presetId);
  return preset ? preset.name : "custom settings";
}

/* ---------- file browser ---------- */

async function openBrowser() {
  $("#browser").hidden = false;
  await showDirectory("");
}

async function showDirectory(path) {
  let data;
  try {
    data = await api(`/api/browse?path=${encodeURIComponent(path)}`);
  } catch (err) {
    toast(err.message);
    return;
  }
  state.browserDir = data.path;
  $("#browser-path").textContent = data.path;
  $("#browser-foot").hidden = false;

  const list = $("#browser-list");
  list.innerHTML = "";
  if (data.parent) {
    list.append(browserRow("↑", "Up one folder", "", () => showDirectory(data.parent)));
  }
  data.entries.forEach((entry) => {
    list.append(browserRow(
      entry.dir ? "▸" : "▪",
      entry.name,
      entry.dir ? "" : formatBytes(entry.size),
      () => (entry.dir ? showDirectory(entry.path) : chooseFile(entry.path)),
    ));
  });
  if (!data.entries.length) {
    const li = document.createElement("li");
    li.className = "browser-path";
    li.textContent = "No videos or subfolders here.";
    list.append(li);
  }
}

function browserRow(icon, label, meta, onClick) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.innerHTML = `<span class="icon"></span><span class="label"></span><span class="size"></span>`;
  btn.querySelector(".icon").textContent = icon;
  btn.querySelector(".label").textContent = label;
  btn.querySelector(".size").textContent = meta;
  btn.addEventListener("click", onClick);
  li.append(btn);
  return li;
}

async function chooseFile(path) {
  try {
    const info = await api("/api/probe", { method: "POST", body: JSON.stringify({ path }) });
    setSource(info);
    $("#browser").hidden = true;
  } catch (err) {
    toast(err.message);
  }
}

async function uploadFile(file) {
  const body = new FormData();
  body.append("file", file);
  const btn = $("#btn-upload");
  btn.disabled = true;
  btn.textContent = "Uploading…";
  try {
    const info = await api("/api/upload", { method: "POST", body });
    setSource(info);
    toast(`${info.name} is ready to encode`, true);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Upload a file";
  }
}

function setSource(info) {
  state.source = info;
  state.settings.input = info.path;
  if (!state.settings.outputName) {
    state.settings.outputName = info.name.replace(/\.[^.]+$/, "");
  }
  state.settings.trim.end = info.duration;
  state.settings.audio.track = info.audio.length ? info.audio[0].index : 0;
  state.settings.subtitle.track = info.subtitles.length ? info.subtitles[0].index : 0;
  fitToSource();
  renderSource();
  renderTrackOptions();
  render();
}

function renderSource() {
  const el = $("#source");
  const src = state.source;
  if (!src) return;
  el.classList.remove("source-empty");
  const v = src.video;
  const facts = [
    ["Length", formatDuration(src.duration)],
    ["Picture", v ? `${v.width}×${v.height}` : "—"],
    ["Framerate", v && v.fps ? `${v.fps.toFixed(3).replace(/\.?0+$/, "")} fps` : "—"],
    ["Video", v ? v.codec : "—"],
    ["Audio", src.audio.length ? `${src.audio.length} track${src.audio.length > 1 ? "s" : ""}` : "none"],
    ["Subtitles", src.subtitles.length || "none"],
    ["Size", formatBytes(src.size)],
    ["Scan", v && v.interlaced ? "interlaced" : "progressive"],
  ];
  el.innerHTML = `<p class="source-name"></p>`;
  el.querySelector(".source-name").textContent = src.name;
  facts.forEach(([label, value]) => {
    const span = document.createElement("span");
    span.className = "source-fact";
    span.innerHTML = `${label} <b></b>`;
    span.querySelector("b").textContent = value;
    el.append(span);
  });
  const details = document.createElement("button");
  details.className = "btn btn-small btn-quiet";
  details.textContent = "All details";
  details.addEventListener("click", () =>
    showProbe(src.name, `/api/probe/raw?path=${encodeURIComponent(src.path)}`));
  el.append(details);
}

function renderTrackOptions() {
  const src = state.source;
  const audio = $("#audio-track");
  const subs = $("#subtitle-track");
  audio.innerHTML = "";
  subs.innerHTML = "";
  if (!src) return;

  src.audio.forEach((t) => {
    audio.append(new Option(
      `${t.index + 1}. ${t.codec}${t.language ? " · " + t.language : ""}` +
      `${t.channels ? " · " + t.channels + "ch" : ""}${t.title ? " · " + t.title : ""}`, t.index));
  });
  if (!src.audio.length) audio.append(new Option("no audio in this file", "0"));

  src.subtitles.forEach((t) => {
    subs.append(new Option(
      `${t.index + 1}. ${t.codec}${t.language ? " · " + t.language : ""}${t.title ? " · " + t.title : ""}`,
      t.index));
  });
  if (!src.subtitles.length) subs.append(new Option("no subtitles in this file", "0"));
}

/* ---------- compare / preview subject ---------- */

// A "subject" is whatever the Preview tab is currently showing: either the
// source picked in the main panel (settings apply live, nothing is encoded
// yet), or a specific queued/running/finished job (its own saved settings,
// or its real output once it's done).
function currentPreviewSubject() {
  if (state.previewJobId) {
    const job = state.jobs.get(state.previewJobId);
    if (job) {
      return {
        label: job.label || baseName(job.output),
        duration: job.duration || 0,
        fps: job.fps || 0,
        targetIsFinal: job.status === "done",
        sourceFrame: (t, w) => frameURL(
          `/api/jobs/${job.id}/frame?which=source&time=${t}${w ? "&width=" + w : ""}`),
        targetFrame: (t, w) => job.status === "done"
          ? frameURL(`/api/jobs/${job.id}/frame?which=output&time=${t}${w ? "&width=" + w : ""}`)
          : frameURL(`/api/jobs/${job.id}/preview-frame?time=${t}${w ? "&width=" + w : ""}`),
      };
    }
    state.previewJobId = null;
  }
  if (state.source) {
    return {
      label: state.source.name,
      duration: state.source.duration || 0,
      fps: state.source.video ? state.source.video.fps : 0,
      targetIsFinal: false,
      sourceFrame: (t, w) => frameURL(
        `/api/frame?path=${encodeURIComponent(state.source.path)}&time=${t}${w ? "&width=" + w : ""}`),
      targetFrame: (t, w) => frameURLPost("/api/preview/frame",
        { input: state.source.path, time: t, width: w || 0, spec: state.settings }),
    };
  }
  return null;
}

async function frameURL(url) {
  const cached = cacheGet(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await readErrorText(res));
  const objURL = URL.createObjectURL(await res.blob());
  cacheSet(url, objURL);
  return objURL;
}

async function frameURLPost(url, body) {
  const key = url + "|" + JSON.stringify(body);
  const cached = cacheGet(key);
  if (cached) return cached;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readErrorText(res));
  const objURL = URL.createObjectURL(await res.blob());
  cacheSet(key, objURL);
  return objURL;
}

async function readErrorText(res) {
  const text = await res.text();
  try { return JSON.parse(text).error || text; } catch { return text || `request failed (${res.status})`; }
}

// A small LRU over object URLs so scrubbing back to a frame you already
// loaded (or re-opening a preview) doesn't re-run ffmpeg. Capped so it can't
// grow without bound over a long session.
const FRAME_CACHE_MAX = 60;
const frameCacheStore = new Map();

function cacheGet(key) {
  if (!frameCacheStore.has(key)) return null;
  const url = frameCacheStore.get(key);
  frameCacheStore.delete(key);
  frameCacheStore.set(key, url); // refresh recency
  return url;
}

function cacheSet(key, url) {
  frameCacheStore.set(key, url);
  if (frameCacheStore.size > FRAME_CACHE_MAX) {
    const oldestKey = frameCacheStore.keys().next().value;
    const oldestURL = frameCacheStore.get(oldestKey);
    frameCacheStore.delete(oldestKey);
    URL.revokeObjectURL(oldestURL);
  }
}

// If a job hasn't started yet, its duration and framerate are unknown to the
// server (files aren't probed until it's their turn), so fetch them once.
async function ensureSubjectMeta(subject) {
  if (subject.duration && subject.fps) return { duration: subject.duration, fps: subject.fps };
  if (state.previewJobId) {
    const job = state.jobs.get(state.previewJobId);
    if (job) {
      if (!job.duration || !job.fps) {
        try {
          const info = await api("/api/probe", { method: "POST", body: JSON.stringify({ path: job.source }) });
          job.duration = info.duration;
          job.fps = info.video ? info.video.fps : 0;
        } catch { /* leave what we have */ }
      }
      return { duration: job.duration || 0, fps: job.fps || 0 };
    }
  }
  return { duration: subject.duration || 0, fps: subject.fps || 0 };
}

function renderPreviewSubjectLabel() {
  const el = $("#preview-subject");
  el.innerHTML = "";
  if (state.previewJobId) {
    const job = state.jobs.get(state.previewJobId);
    const label = document.createElement("span");
    label.textContent = job ? `Previewing job: ${job.label}` : "That job is gone.";
    const back = document.createElement("button");
    back.className = "btn btn-small btn-quiet";
    back.textContent = "Use current settings instead";
    back.addEventListener("click", () => {
      state.previewJobId = null;
      renderPreviewSubjectLabel();
      refreshPreviewRange();
    });
    el.append(label, back);
  } else {
    const label = document.createElement("span");
    label.textContent = state.source ? `Previewing: ${state.source.name}` : "Pick a source to preview.";
    el.append(label);
  }
}

async function refreshPreviewRange() {
  let subject = currentPreviewSubject();
  const slider = $("#preview-time");
  if (!subject) {
    slider.max = 0;
    slider.value = 0;
    $("#preview-time-input").value = "";
    $("#preview-time-label").textContent = "";
    loadDiffFrames();
    return;
  }
  const meta = await ensureSubjectMeta(subject);
  slider.max = meta.duration || 0;
  if (!slider.value || Number(slider.value) > meta.duration) {
    slider.value = meta.duration ? meta.duration / 2 : 0;
  }
  setPreviewTime(Number(slider.value));
  loadDiffFrames();
}

function setPreviewTime(t) {
  t = clampNum(t || 0, 0, Number($("#preview-time").max) || t || 0);
  $("#preview-time").value = t;
  $("#preview-time-input").value = formatPreciseTime(t);
  const subject = currentPreviewSubject();
  $("#preview-time-label").textContent = subject && subject.duration
    ? `${formatDuration(t)} of ${formatDuration(subject.duration)}` : subject ? "length unknown yet" : "";
}

function formatPreciseTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

async function stepFrame(delta) {
  const subject = currentPreviewSubject();
  if (!subject) return;
  const meta = await ensureSubjectMeta(subject);
  const fps = meta.fps > 0 ? meta.fps : 25;
  const t = (Number($("#preview-time").value) || 0) + delta * (1 / fps);
  setPreviewTime(t);
  loadDiffFrames();
}

async function loadDiffFrames() {
  const subject = currentPreviewSubject();
  if (!subject || !subject.duration) {
    state.previewFrames = { time: 0, sourceURL: null, targetURL: null, targetIsFinal: false };
    updateDiffDisplay();
    return;
  }
  const t = Number($("#preview-time").value) || 0;
  setPreviewTime(t);

  const stage = $("#diff-stage");
  const width = Math.min(1280, Math.round(stage.clientWidth) || 960) || 960;
  try {
    const [sourceURL, targetURL] = await Promise.all([subject.sourceFrame(t, width), subject.targetFrame(t, width)]);
    state.previewFrames = { time: t, sourceURL, targetURL, targetIsFinal: subject.targetIsFinal };
    updateDiffDisplay();
    $("#diff-note").textContent = subject.targetIsFinal
      ? "The target frame is from the actual encoded file."
      : "The target frame is a live preview of the current settings — actual compression will look slightly softer.";
  } catch (err) {
    toast(err.message);
  }
}

// Object URLs are owned by the frame cache now (see cacheSet's eviction), so
// this only decides what's on screen — it never revokes anything itself.
function updateDiffDisplay() {
  const hasFrames = !!(state.previewFrames.sourceURL && state.previewFrames.targetURL);
  $("#diff-empty").hidden = hasFrames;
  if (!hasFrames) {
    $("#diff-stage").hidden = false;
    $("#diff-base").hidden = true;
    $("#diff-overlay").hidden = true;
    $("#diff-handle").hidden = true;
    $("#diff-sbs").hidden = true;
    $("#diff-canvas").hidden = true;
    $("#dl-diff").hidden = true;
    return;
  }
  applyDiffLayers();
  applyComparisonMode();
}

function applyDiffLayers() {
  const overlayIsTarget = state.diff.overlayIsTarget;
  $("#diff-base").src = overlayIsTarget ? state.previewFrames.sourceURL || "" : state.previewFrames.targetURL || "";
  $("#diff-overlay").src = overlayIsTarget ? state.previewFrames.targetURL || "" : state.previewFrames.sourceURL || "";
  $("#diff-overlay-label").textContent = overlayIsTarget
    ? "Overlay: target — drag left to reveal the source"
    : "Overlay: source — drag left to reveal the target";
  $("#sbs-source").src = state.previewFrames.sourceURL || "";
  $("#sbs-target").src = state.previewFrames.targetURL || "";
}

// Shows/hides the right elements for the chosen comparison mode and does any
// mode-specific rendering (the difference canvas, the flicker timer).
function applyComparisonMode() {
  stopFlicker();
  const mode = state.diff.mode;
  const stacked = mode === "split" || mode === "overlay" || mode === "flicker";

  $("#diff-stage").hidden = mode === "side-by-side" || mode === "difference";
  $("#diff-sbs").hidden = mode !== "side-by-side";
  $("#diff-canvas").hidden = mode !== "difference";
  $("#diff-opacity-field").hidden = mode !== "overlay";
  $("#dl-diff").hidden = mode !== "difference";

  $("#diff-base").hidden = !stacked;
  $("#diff-overlay").hidden = !stacked;
  $("#diff-handle").hidden = mode !== "split";
  $("#diff-base").style.visibility = "";
  $("#diff-overlay").style.visibility = "";

  const magnifierApplicable = stacked;
  $("#diff-magnifier-field").hidden = !magnifierApplicable;
  if (!magnifierApplicable && state.diff.magnifier) {
    state.diff.magnifier = false;
    $("#diff-magnifier").checked = false;
    $("#diff-lens").hidden = true;
  }

  if (mode === "split") {
    $("#diff-overlay").style.opacity = "1";
    setDividerPercent(state.diff.dividerPct);
  } else if (mode === "overlay") {
    $("#diff-overlay").style.clipPath = "inset(0)";
    $("#diff-overlay").style.opacity = String(state.diff.opacity / 100);
  } else if (mode === "flicker") {
    $("#diff-overlay").style.opacity = "1";
    $("#diff-overlay").style.clipPath = "inset(0)";
    startFlicker();
  } else if (mode === "difference") {
    renderDifferenceCanvas();
  }
}

function setDividerPercent(pct) {
  pct = clampNum(pct, 0, 100);
  state.diff.dividerPct = pct;
  $("#diff-handle").style.left = `${pct}%`;
  $("#diff-overlay").style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
}

let flickerTimer = null;
function startFlicker() {
  stopFlicker();
  let showTarget = true;
  flickerTimer = setInterval(() => {
    $("#diff-base").style.visibility = showTarget ? "hidden" : "visible";
    $("#diff-overlay").style.visibility = showTarget ? "visible" : "hidden";
    showTarget = !showTarget;
  }, 400);
}
function stopFlicker() {
  if (flickerTimer) { clearInterval(flickerTimer); flickerTimer = null; }
}

function renderDifferenceCanvas() {
  const canvas = $("#diff-canvas");
  const { sourceURL, targetURL } = state.previewFrames;
  if (!sourceURL || !targetURL) return;
  const srcImg = new Image();
  const tgtImg = new Image();
  let loaded = 0;
  const onBoth = () => {
    const w = Math.min(960, srcImg.naturalWidth || 640);
    const h = Math.round(w * ((srcImg.naturalHeight || 360) / (srcImg.naturalWidth || 640)));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(srcImg, 0, 0, w, h);
    const a = ctx.getImageData(0, 0, w, h);
    ctx.drawImage(tgtImg, 0, 0, w, h);
    const b = ctx.getImageData(0, 0, w, h);
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < a.data.length; i += 4) {
      out.data[i] = Math.abs(a.data[i] - b.data[i]);
      out.data[i + 1] = Math.abs(a.data[i + 1] - b.data[i + 1]);
      out.data[i + 2] = Math.abs(a.data[i + 2] - b.data[i + 2]);
      out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  };
  srcImg.onload = () => { if (++loaded === 2) onBoth(); };
  tgtImg.onload = () => { if (++loaded === 2) onBoth(); };
  srcImg.src = sourceURL;
  tgtImg.src = targetURL;
}

let lastLensX = 0;
let lastLensY = 0;

function positionLens(x, y, rect) {
  const lens = $("#diff-lens");
  const size = 190;
  const zoom = state.diff.magZoom;
  lens.style.width = `${size}px`;
  lens.style.height = `${size}px`;
  lens.style.left = `${x - size / 2}px`;
  lens.style.top = `${y - size / 2}px`;
  const activeURL = state.diff.magnifierShowsTarget ? state.previewFrames.targetURL : state.previewFrames.sourceURL;
  lens.style.backgroundImage = activeURL ? `url(${activeURL})` : "none";
  lens.style.backgroundSize = `${rect.width * zoom}px ${rect.height * zoom}px`;
  lens.style.backgroundPosition = `${-(x * zoom - size / 2)}px ${-(y * zoom - size / 2)}px`;
  lens.hidden = false;
}

function downloadURL(url, filename) {
  if (!url) { toast("No frame loaded yet"); return; }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

function frameFileStamp(t) {
  return formatPreciseTime(t).replace(":", "m").replace(".", "s");
}

/* ---------- screenshots ---------- */

async function generateThumbnails() {
  const subject = currentPreviewSubject();
  if (!subject) { toast("Pick a source first"); return; }
  const meta = await ensureSubjectMeta(subject);
  if (!meta.duration) { toast("This file's length isn't known yet — try again once it starts."); return; }

  const count = clampNum(Math.round(Number($("#thumb-count").value)) || 8, 2, 24);
  const scale = clampNum(Math.round(Number($("#thumb-scale").value)) || 160, 60, 640);
  const times = Array.from({ length: count }, (_, i) => (meta.duration * (i + 0.5)) / count);
  const srcRow = $("#thumb-source-strip");
  const tgtRow = $("#thumb-target-strip");
  const timeline = $("#thumb-timeline");
  srcRow.innerHTML = "";
  tgtRow.innerHTML = "";
  timeline.innerHTML = "";

  const btn = $("#thumb-generate");
  btn.disabled = true;
  btn.textContent = "Generating…";
  try {
    const results = await Promise.all(times.map(async (t) => {
      const [srcURL, tgtURL] = await Promise.all([
        subject.sourceFrame(t, scale).catch(() => null),
        subject.targetFrame(t, scale).catch(() => null),
      ]);
      return { t, srcURL, tgtURL };
    }));
    results.forEach(({ t, srcURL, tgtURL }) => {
      if (srcURL) {
        srcRow.append(thumbButton(srcURL, t));
        timeline.append(timelineTick(srcURL, t));
      }
      if (tgtURL) tgtRow.append(thumbButton(tgtURL, t));
    });
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate screenshots";
  }
}

function thumbButton(url, t) {
  const btn = document.createElement("button");
  btn.className = "thumb";
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  const time = document.createElement("time");
  time.textContent = formatDuration(t);
  btn.append(img, time);
  btn.addEventListener("click", () => { setPreviewTime(t); loadDiffFrames(); });
  return btn;
}

function timelineTick(url, t) {
  const btn = document.createElement("button");
  btn.className = "thumb-tick";
  btn.style.backgroundImage = `url(${url})`;
  btn.title = formatDuration(t);
  btn.addEventListener("click", () => { setPreviewTime(t); loadDiffFrames(); });
  return btn;
}

/* ---------- probe viewer ---------- */



async function showProbe(title, url) {
  const modal = $("#probe");
  modal.hidden = false;
  $("#probe-title").textContent = title;
  $("#probe-path").textContent = "";
  $("#probe-body").textContent = "Reading…";
  try {
    const data = await api(url);
    $("#probe-path").textContent = (data.format && data.format.filename) || "";
    $("#probe-body").innerHTML = highlightJSON(JSON.stringify(data, null, 2));
  } catch (err) {
    $("#probe-body").textContent = err.message;
  }
}

function highlightJSON(text) {
  const escaped = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return escaped.replace(/("(\\.|[^"\\])*")(\s*:)?|\b(-?\d+(\.\d+)?)\b/g,
    (match, str, _b, colon, num) => {
      if (str) return `<span class="${colon ? "k" : "s"}">${str}</span>${colon || ""}`;
      return `<span class="n">${num}</span>`;
    });
}

/* ---------- derived info ---------- */

function outputDimensions() {
  const src = state.source;
  const pic = state.settings.picture;
  if (!src || !src.video) return null;
  let w = src.video.width - pic.cropLeft - pic.cropRight;
  let h = src.video.height - pic.cropTop - pic.cropBottom;
  if (w <= 0 || h <= 0) return null;

  if (pic.scaleMode === "custom" && pic.width > 0 && pic.height > 0) {
    if (pic.keepAspect && !pic.pad) {
      const ratio = Math.min(pic.width / w, pic.height / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    } else {
      w = pic.width;
      h = pic.height;
    }
  }
  if (state.settings.filters.rotate % 180 === 90) [w, h] = [h, w];
  return { w: w - (w % 2), h: h - (h % 2) };
}

function encodedSeconds() {
  const src = state.source;
  if (!src) return 0;
  const trim = state.settings.trim;
  if (trim.enabled && trim.end > trim.start) return trim.end - trim.start;
  return src.duration;
}

function renderRecap() {
  const s = state.settings;
  const dims = outputDimensions();
  const names = { x264: "H.264", x265: "H.265", vp9: "VP9", av1: "AV1", copy: "unchanged video" };
  const rows = [
    ["Source", state.source ? state.source.name : "nothing chosen yet"],
    ["Video", s.video.encoder === "copy" ? "copied as-is"
      : `${names[s.video.encoder]} · ${s.video.rateMode === "quality"
        ? `quality ${s.video.quality}`
        : `${s.video.bitrate} kbit/s${s.video.twoPass ? " · two passes" : ""}`} · ${s.video.speed}`],
    ["Picture", dims ? `${dims.w}×${dims.h}` : "—"],
    ["Audio", s.audio.encoder === "none" ? "removed"
      : s.audio.encoder === "copy" ? "copied as-is"
        : `${s.audio.encoder.toUpperCase()} ${s.audio.bitrate} kbit/s · ${s.audio.mixdown}`],
    ["Subtitles", { none: "left out", copy: "kept as a track", burn: "burned in" }[s.subtitle.mode]],
    ["Length", formatDuration(encodedSeconds())],
    ["Writes", `${s.outputName || (state.source ? state.source.name.replace(/\.[^.]+$/, "") : "output")}.${s.container}`],
  ];
  const extras = [s.extra.encoderOptions, s.extra.inputArgs, s.extra.outputArgs].filter(Boolean);
  if (extras.length) rows.push(["Extra options", extras.join("  ")]);

  const dl = $("#recap");
  dl.innerHTML = "";
  rows.forEach(([term, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  });
}

function renderEstimates() {
  const s = state.settings;
  const seconds = encodedSeconds();
  const estimate = $("#size-estimate");
  if (seconds && s.video.rateMode === "bitrate") {
    const audioRate = s.audio.encoder === "none" ? 0 : s.audio.bitrate;
    const bytes = ((s.video.bitrate + audioRate) * 1000 * seconds) / 8;
    const against = state.source && state.source.size
      ? ` — the source is ${formatBytes(state.source.size)}.` : ".";
    estimate.textContent = `About ${formatBytes(bytes)} at this bitrate${against}`;
  } else {
    estimate.textContent = "";
  }

  const dims = outputDimensions();
  $("#output-size").textContent = dims
    ? `The finished video will be ${dims.w}×${dims.h} pixels.`
    : state.source ? "Those crop values remove the whole picture." : "";

  $("#filters-warning").textContent = s.video.encoder === "copy"
    ? "Filters are ignored while the original video is kept as-is." : "";
}

function renderCropPreview() {
  const src = state.source;
  const pic = state.settings.picture;
  const box = $("#crop-preview");
  if (!src || !src.video) { box.style.inset = "0"; return; }
  const pct = (v, total) => `${Math.min(45, (v / Math.max(total, 1)) * 100)}%`;
  box.style.inset = [
    pct(pic.cropTop, src.video.height),
    pct(pic.cropRight, src.video.width),
    pct(pic.cropBottom, src.video.height),
    pct(pic.cropLeft, src.video.width),
  ].join(" ");
}

let previewTimer;
function refreshCommandPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const box = $("#cmd-preview");
    if (!box || !$('.panel[data-panel="advanced"]').classList.contains("is-active")) return;
    try {
      const data = await api("/api/preview", { method: "POST", body: JSON.stringify(state.settings) });
      box.innerHTML = "";
      const bin = document.createElement("b");
      bin.textContent = data.bin;
      box.append(bin, " " + data.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "));
    } catch (err) {
      box.textContent = err.message;
    }
  }, 250);
}

/* ---------- queueing ---------- */

async function queueEncode() {
  if (!state.source) return;
  state.settings.input = state.source.path;
  const btn = $("#btn-queue");
  btn.disabled = true;
  try {
    if (state.editingJobId) {
      await api(`/api/jobs/${state.editingJobId}`, { method: "PUT", body: JSON.stringify(state.settings) });
      toast("Job updated", true);
      state.editingJobId = null;
    } else {
      await api("/api/jobs", { method: "POST", body: JSON.stringify(state.settings) });
      toast("Added to the queue", true);
    }
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = !state.source;
    updateEditingBanner();
  }
}

/* ---------- per-job edit and preview ---------- */

async function editJob(job) {
  try {
    const info = await api("/api/probe", { method: "POST", body: JSON.stringify({ path: job.source }) });
    state.source = info;
    state.settings = { ...defaultSettings(), ...structuredClone(job.spec) };
    state.settings.input = info.path;
    state.editingJobId = job.id;
    state.previewJobId = null;
    state.presetId = null;
    fitToSource();
    renderSource();
    renderTrackOptions();
    updateEditingBanner();
    render();
    refreshPreviewRange();
    switchTab("summary");
    toast(`Editing ${job.label}`, true);
  } catch (err) {
    toast(err.message);
  }
}

function cancelEdit() {
  state.editingJobId = null;
  updateEditingBanner();
}

function updateEditingBanner() {
  const banner = $("#edit-banner");
  const btn = $("#btn-queue");
  if (state.editingJobId && state.jobs.has(state.editingJobId)) {
    banner.hidden = false;
    btn.textContent = "Save changes";
  } else {
    if (state.editingJobId && !state.jobs.has(state.editingJobId)) state.editingJobId = null;
    banner.hidden = true;
    btn.textContent = "Add to queue";
  }
}

async function previewJobAction(job) {
  state.previewJobId = job.id;
  switchTab("preview");
  await refreshPreviewRange();
}

/* ---------- batch ---------- */



async function openBatch(dir) {
  state.batchDir = dir;
  $("#browser").hidden = true;
  $("#batch").hidden = false;
  $("#batch-path").textContent = dir;
  $("#batch-preset").textContent = `Using ${presetName()}`;
  await refreshBatchPreview();
}

async function refreshBatchPreview() {
  const recursive = $("#batch-recursive").checked;
  $("#batch-count").textContent = "Scanning…";
  $("#batch-preview").innerHTML = "";
  try {
    const data = await api(
      `/api/scan?path=${encodeURIComponent(state.batchDir)}&recursive=${recursive}`);
    $("#batch-count").textContent =
      `${data.count} video${data.count === 1 ? "" : "s"}, ${formatBytes(data.totalSize)} in total.`;
    data.files.slice(0, 200).forEach((f) => {
      const li = document.createElement("li");
      li.textContent = f.rel;
      $("#batch-preview").append(li);
    });
    if (data.count > 200) {
      const li = document.createElement("li");
      li.textContent = `…and ${data.count - 200} more`;
      $("#batch-preview").append(li);
    }
    $("#batch-go").disabled = data.count === 0;
  } catch (err) {
    $("#batch-count").textContent = err.message;
    $("#batch-go").disabled = true;
  }
}

async function queueBatch() {
  const btn = $("#batch-go");
  btn.disabled = true;
  btn.textContent = "Queueing…";
  try {
    const result = await api("/api/batch", {
      method: "POST",
      body: JSON.stringify({
        dir: state.batchDir,
        recursive: $("#batch-recursive").checked,
        includeTopFolder: $("#batch-tree").checked,
        skipExisting: $("#batch-skip").checked,
        spec: state.settings,
      }),
    });
    $("#batch").hidden = true;
    toast(`Queued ${result.queued} file${result.queued === 1 ? "" : "s"}` +
      (result.skipped ? `, skipped ${result.skipped} already done` : ""), true);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Queue them all";
  }
}

/* ---------- queue settings ---------- */

function renderQueueSettings() {
  const s = state.queue.settings;
  if (!s) return;
  $("#set-verify").checked = s.verifyOutput;
  $("#set-autodelete").checked = s.autoDeleteSource;
  if (document.activeElement !== $("#set-threshold")) $("#set-threshold").value = s.shrinkThreshold;
  $("#set-hook-type").value = s.postQueue.type || "none";
  if (document.activeElement !== $("#set-hook-url")) $("#set-hook-url").value = s.postQueue.url || "";
  if (document.activeElement !== $("#set-hook-cmd")) $("#set-hook-cmd").value = s.postQueue.command || "";

  $("#hook-url-field").classList.toggle("is-hidden", s.postQueue.type !== "webhook");
  $("#hook-cmd-field").classList.toggle("is-hidden", s.postQueue.type !== "command");
  $("#hook-note").textContent = s.postQueue.type === "command" && !state.config.allowCommands
    ? "Running a command needs the server started with -allow-commands."
    : s.autoDeleteSource
      ? `Sources are deleted only after the new file passes the check and is at least ${s.shrinkThreshold}% smaller.`
      : "";

  $("#btn-pause").textContent = state.queue.paused ? "Resume" : "Pause";
  $("#btn-pause").classList.toggle("btn-primary", state.queue.paused);
}

async function pushQueueSettings() {
  const settings = {
    verifyOutput: $("#set-verify").checked,
    autoDeleteSource: $("#set-autodelete").checked,
    shrinkThreshold: Number($("#set-threshold").value || 0),
    postQueue: {
      type: $("#set-hook-type").value,
      url: $("#set-hook-url").value,
      command: $("#set-hook-cmd").value,
    },
  };
  try {
    state.queue.settings = await api("/api/queue/settings",
      { method: "POST", body: JSON.stringify(settings) });
  } catch (err) {
    toast(err.message);
  }
  renderQueueSettings();
  renderQueue();
}

/* ---------- queue rendering ---------- */

function renderQueue() {
  const list = $("#queue-list");
  const jobs = Array.from(state.jobs.values());

  if (!jobs.length) {
    list.innerHTML = `<p class="queue-empty">Nothing queued yet.</p>`;
    $("#queue-summary").textContent = state.queue.paused ? "paused" : "";
    return;
  }

  const count = (status) => jobs.filter((j) => j.status === status).length;
  const waiting = count("queued");
  const remaining = jobs
    .filter((j) => j.status === "queued" || j.status === "running")
    .reduce((acc, j) => acc + (j.eta > 0 ? j.eta : 0), 0);
  $("#queue-summary").textContent =
    `${count("running")} encoding · ${waiting} waiting · ${count("done")} done` +
    `${count("failed") ? ` · ${count("failed")} failed` : ""}` +
    `${remaining > 0 ? ` · about ${formatDuration(remaining)} left on the current file` : ""}` +
    `${state.queue.paused ? " · paused" : ""}`;

  list.innerHTML = "";
  jobs.forEach((job) => list.append(jobRow(job)));
}

function jobRow(job) {
  const row = document.createElement("article");
  row.className = `job ${job.status}${job.sourceDeleted ? " deleted-source" : ""}`;

  const title = document.createElement("div");
  title.className = "job-title";
  title.textContent = job.label || baseName(job.output);

  const meta = document.createElement("div");
  meta.className = "job-sub job-meta";
  meta.append(stateBadge(job));
  jobFacts(job).forEach((fact) => {
    const span = document.createElement("span");
    span.className = fact.className || "";
    span.textContent = fact.text;
    meta.append(span);
  });

  const actions = document.createElement("div");
  actions.className = "job-actions";
  jobActions(job).forEach((el) => actions.append(el));

  const bar = document.createElement("div");
  bar.className = "job-bar";
  const fill = document.createElement("i");
  fill.style.width = `${Math.round((job.progress || 0) * 100)}%`;
  bar.append(fill);

  row.append(title, meta, actions, bar);

  if (job.error) {
    const err = document.createElement("p");
    err.className = "job-error";
    err.textContent = job.error;
    row.append(err);
  }
  return row;
}

function jobFacts(job) {
  const facts = [];
  if (job.status === "running") {
    facts.push({ text: `${Math.round((job.progress || 0) * 100)}%` });
    if (job.passes > 1) facts.push({ text: `pass ${job.pass} of ${job.passes}` });
    if (job.fps) facts.push({ text: `${job.fps.toFixed(0)} fps` });
    if (job.speed) facts.push({ text: `${job.speed.toFixed(2)}× realtime` });
    if (job.eta > 0) facts.push({ text: `${formatDuration(job.eta)} left` });
    if (job.estimatedSize > 0) {
      facts.push({ text: `heading for about ${formatBytes(job.estimatedSize)}` });
      if (job.sourceSize > 0) facts.push(savingFact(job.savedPct, true));
    }
  } else if (job.status === "done") {
    const took = (new Date(job.ended) - new Date(job.started)) / 1000;
    facts.push({ text: `${formatBytes(job.outSize)} from ${formatBytes(job.sourceSize)}` });
    if (job.sourceSize > 0) facts.push(savingFact(job.savedPct, false));
    facts.push({ text: `took ${formatDuration(took)}` });
    if (job.verified) {
      facts.push({ text: `checked: ${job.verifyNote}`, className: "job-verified" });
    } else if (job.verifyNote) {
      facts.push({ text: job.verifyNote });
    }
  } else {
    facts.push({ text: baseName(job.source), className: "job-path" });
    if (job.sourceSize) facts.push({ text: formatBytes(job.sourceSize) });
    if (job.attempts > 1) facts.push({ text: `attempt ${job.attempts}` });
  }
  return facts;
}

function savingFact(pct, projected) {
  const rounded = Math.round(pct);
  if (rounded >= 0) {
    return {
      text: `${projected ? "about " : ""}${rounded}% smaller`,
      className: "job-saving",
    };
  }
  return {
    text: `${projected ? "about " : ""}${Math.abs(rounded)}% bigger`,
    className: "job-saving negative",
  };
}

function jobActions(job) {
  const out = [];
  const threshold = state.queue.settings ? state.queue.settings.shrinkThreshold : 20;

  if (job.status === "queued") {
    out.push(moveButton("↑", job.id, -1), moveButton("↓", job.id, 1), moveButton("⤒", job.id, 0));
  }
  out.push(actionButton("Preview", () => previewJobAction(job)));
  if (job.status !== "running") {
    out.push(actionButton("Edit", () => editJob(job)));
  }
  if (job.status === "running" || job.status === "queued") {
    out.push(actionButton("Cancel", () => api(`/api/jobs/${job.id}/cancel`, { method: "POST" })));
    return out;
  }

  if (job.status === "done") {
    const link = document.createElement("a");
    link.className = "btn btn-small";
    link.href = `/api/jobs/${job.id}/file`;
    link.textContent = "Download";
    out.push(link);
    out.push(actionButton("Details", () =>
      showProbe(baseName(job.output), `/api/jobs/${job.id}/probe?which=output`), false));
    if (!job.sourceDeleted && job.savedPct >= threshold) {
      out.push(actionButton(`Delete source (${Math.round(job.savedPct)}% smaller)`, async () => {
        if (!confirm(`Delete the original file?\n\n${job.source}\n\nThis cannot be undone.`)) return;
        await api(`/api/jobs/${job.id}/delete-source`, { method: "POST" });
        toast("Source deleted", true);
      }));
    }
  }
  if (job.status === "failed" || job.status === "canceled" || job.status === "done") {
    if (!job.sourceDeleted) {
      out.push(actionButton("Encode again", () => api(`/api/jobs/${job.id}/retry`, { method: "POST" })));
    }
    out.push(actionButton("Remove", () => api(`/api/jobs/${job.id}`, { method: "DELETE" })));
  }
  return out;
}

function moveButton(glyph, id, delta) {
  const btn = actionButton(glyph, () =>
    api(`/api/jobs/${id}/move`, { method: "POST", body: JSON.stringify({ delta }) }));
  btn.classList.add("move-btn");
  btn.title = delta === 0 ? "Move to the top" : delta < 0 ? "Move up" : "Move down";
  return btn;
}

function stateBadge(job) {
  const span = document.createElement("span");
  span.className = "job-state";
  span.textContent = {
    queued: "waiting", running: "encoding", done: "finished",
    failed: "failed", canceled: "cancelled",
  }[job.status] || job.status;
  return span;
}

function actionButton(label, handler, quiet = true) {
  const btn = document.createElement("button");
  btn.className = `btn btn-small${quiet ? " btn-quiet" : ""}`;
  btn.textContent = label;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try { await handler(); } catch (err) { toast(err.message); btn.disabled = false; }
  });
  return btn;
}

/* ---------- events ---------- */

function applySnapshot(data) {
  state.jobs.clear();
  (data.jobs || []).forEach((job) => state.jobs.set(job.id, job));
  if (typeof data.paused === "boolean") state.queue.paused = data.paused;
  if (data.settings) state.queue.settings = data.settings;
  renderQueueSettings();
  renderQueue();
}

function connectEvents() {
  const source = new EventSource("/api/events");
  source.addEventListener("snapshot", (e) => applySnapshot(JSON.parse(e.data)));
  source.addEventListener("job", (e) => {
    const job = JSON.parse(e.data);
    state.jobs.set(job.id, job);
    renderQueue();
  });
  source.addEventListener("queue", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.removed) state.jobs.delete(msg.removed);
    if (typeof msg.paused === "boolean") state.queue.paused = msg.paused;
    if (msg.settings) state.queue.settings = msg.settings;
    if (msg.order) reorderJobs(msg.order);
    if (msg.drained) {
      toast(`Queue finished — ${msg.drained.done} done` +
        (msg.drained.failed ? `, ${msg.drained.failed} failed` : ""), !msg.drained.failed);
    }
    renderQueueSettings();
    renderQueue();
  });
  source.onerror = () => { /* EventSource reconnects by itself */ };
}

function reorderJobs(order) {
  const next = new Map();
  order.forEach((id) => { if (state.jobs.has(id)) next.set(id, state.jobs.get(id)); });
  state.jobs.forEach((job, id) => { if (!next.has(id)) next.set(id, job); });
  state.jobs = next;
}

/* ---------- render ---------- */

function render() {
  syncQualityScale();
  syncInputs();
  applyVisibility();
  $$(".seg[data-ratemode]").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.ratemode === state.settings.video.rateMode));
  $$(".preset").forEach((b) => b.classList.toggle("is-active", b.dataset.id === state.presetId));
  $("#btn-queue").disabled = !state.source;
  renderRecap();
  renderEstimates();
  renderCropPreview();
  refreshCommandPreview();
  updateEditingBanner();
}

/* ---------- wiring ---------- */

$("#btn-browse").addEventListener("click", openBrowser);
$("#btn-folder").addEventListener("click", openBrowser);
$("#browser-usedir").addEventListener("click", () => openBatch(state.browserDir));
$("#btn-upload").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", (e) => {
  if (e.target.files[0]) uploadFile(e.target.files[0]);
  e.target.value = "";
});

["#browser", "#batch", "#probe"].forEach((sel) => {
  const modal = $(sel);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
});
$("#browser-close").addEventListener("click", () => { $("#browser").hidden = true; });
$("#batch-close").addEventListener("click", () => { $("#batch").hidden = true; });
$("#probe-close").addEventListener("click", () => { $("#probe").hidden = true; });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  ["#browser", "#batch", "#probe"].forEach((sel) => { $(sel).hidden = true; });
});

$("#batch-recursive").addEventListener("change", refreshBatchPreview);
$("#batch-go").addEventListener("click", queueBatch);
$("#btn-queue").addEventListener("click", queueEncode);

$("#btn-pause").addEventListener("click", async () => {
  try {
    await api("/api/queue/pause", {
      method: "POST", body: JSON.stringify({ paused: !state.queue.paused }),
    });
  } catch (err) { toast(err.message); }
});

$("#btn-settings").addEventListener("click", () => {
  const panel = $("#queue-settings");
  panel.hidden = !panel.hidden;
});
["#set-verify", "#set-autodelete", "#set-threshold", "#set-hook-type", "#set-hook-url", "#set-hook-cmd"]
  .forEach((sel) => {
    const el = $(sel);
    el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "change",
      pushQueueSettings);
  });

$("#btn-export").addEventListener("click", () => { window.location.href = "/api/queue/export"; });
$("#btn-import").addEventListener("click", () => $("#import-input").click());
$("#import-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const result = await api("/api/queue/import", { method: "POST", body: await file.text() });
    toast(`Imported ${result.added} job${result.added === 1 ? "" : "s"}` +
      (result.rejected.length ? `, ${result.rejected.length} could not be added` : ""), true);
    if (result.rejected.length) console.warn("rejected imports:", result.rejected);
  } catch (err) {
    toast(err.message);
  }
});

$("#btn-clear").addEventListener("click", async () => {
  const finished = Array.from(state.jobs.values())
    .filter((j) => ["done", "failed", "canceled"].includes(j.status));
  for (const job of finished) {
    try { await api(`/api/jobs/${job.id}`, { method: "DELETE" }); } catch { /* already gone */ }
  }
});

$("#edit-cancel").addEventListener("click", cancelEdit);

const debouncedLoadDiffFrames = debounce(loadDiffFrames, 200);

$("#preview-time").addEventListener("input", () => {
  setPreviewTime(Number($("#preview-time").value) || 0);
  debouncedLoadDiffFrames();
});
$("#preview-time-input").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  setPreviewTime(parseTimecode(e.target.value));
  loadDiffFrames();
});
$("#preview-time-input").addEventListener("blur", (e) => {
  setPreviewTime(parseTimecode(e.target.value));
});
$("#preview-step-back").addEventListener("click", () => stepFrame(-1));
$("#preview-step-fwd").addEventListener("click", () => stepFrame(1));
$("#preview-refresh").addEventListener("click", loadDiffFrames);
$("#preview-jump-start").addEventListener("click", () => {
  setPreviewTime(state.settings.trim.start || 0);
  loadDiffFrames();
});
$("#preview-jump-mid").addEventListener("click", async () => {
  const subject = currentPreviewSubject();
  if (!subject) return;
  const meta = await ensureSubjectMeta(subject);
  setPreviewTime(meta.duration / 2 || 0);
  loadDiffFrames();
});
$("#preview-jump-end").addEventListener("click", async () => {
  const subject = currentPreviewSubject();
  if (!subject) return;
  const meta = await ensureSubjectMeta(subject);
  const t = state.settings.trim.enabled && state.settings.trim.end > 0 ? state.settings.trim.end : meta.duration;
  setPreviewTime(t);
  loadDiffFrames();
});

$$("#diff-mode .seg").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.diff.mode = btn.dataset.mode;
    $$("#diff-mode .seg").forEach((b) => b.classList.toggle("is-active", b === btn));
    applyComparisonMode();
  });
});

$("#diff-swap").addEventListener("click", () => {
  state.diff.overlayIsTarget = !state.diff.overlayIsTarget;
  applyDiffLayers();
});

$("#diff-opacity").addEventListener("input", (e) => {
  state.diff.opacity = Number(e.target.value);
  $("#diff-opacity-value").textContent = `${state.diff.opacity}%`;
  if (state.diff.mode === "overlay") $("#diff-overlay").style.opacity = String(state.diff.opacity / 100);
});

$("#diff-fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  const target = state.diff.mode === "side-by-side" ? $("#diff-sbs")
    : state.diff.mode === "difference" ? $("#diff-canvas")
    : $("#diff-stage");
  target.requestFullscreen?.().catch((err) => toast(err.message));
});

$("#dl-source").addEventListener("click", () =>
  downloadURL(state.previewFrames.sourceURL, `source-${frameFileStamp(state.previewFrames.time)}.jpg`));
$("#dl-target").addEventListener("click", () =>
  downloadURL(state.previewFrames.targetURL, `target-${frameFileStamp(state.previewFrames.time)}.jpg`));
$("#dl-diff").addEventListener("click", () => {
  $("#diff-canvas").toBlob((blob) => {
    if (!blob) { toast("Nothing to download yet"); return; }
    const url = URL.createObjectURL(blob);
    downloadURL(url, `difference-${frameFileStamp(state.previewFrames.time)}.png`);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
});

{
  let dragging = false;
  const stage = $("#diff-stage");
  const startDrag = (e) => { dragging = true; e.preventDefault(); };
  const moveDrag = (clientX) => {
    if (!dragging) return;
    const rect = stage.getBoundingClientRect();
    setDividerPercent(((clientX - rect.left) / rect.width) * 100);
  };
  $("#diff-handle").addEventListener("mousedown", startDrag);
  $("#diff-handle").addEventListener("touchstart", (e) => startDrag(e), { passive: false });
  document.addEventListener("mousemove", (e) => moveDrag(e.clientX));
  document.addEventListener("touchmove", (e) => { if (dragging) moveDrag(e.touches[0].clientX); }, { passive: true });
  document.addEventListener("mouseup", () => { dragging = false; });
  document.addEventListener("touchend", () => { dragging = false; });

  stage.addEventListener("mousemove", (e) => {
    if (!state.diff.magnifier) return;
    const rect = stage.getBoundingClientRect();
    lastLensX = e.clientX - rect.left;
    lastLensY = e.clientY - rect.top;
    positionLens(lastLensX, lastLensY, rect);
  });
  stage.addEventListener("touchmove", (e) => {
    if (!state.diff.magnifier || !e.touches[0]) return;
    const rect = stage.getBoundingClientRect();
    lastLensX = e.touches[0].clientX - rect.left;
    lastLensY = e.touches[0].clientY - rect.top;
    positionLens(lastLensX, lastLensY, rect);
  }, { passive: true });
  stage.addEventListener("mouseleave", () => { $("#diff-lens").hidden = true; });
  stage.addEventListener("wheel", (e) => {
    if (!state.diff.magnifier) return;
    e.preventDefault();
    state.diff.magZoom = clampNum(state.diff.magZoom + (e.deltaY < 0 ? 0.4 : -0.4), 1.5, 8);
    positionLens(lastLensX, lastLensY, stage.getBoundingClientRect());
  }, { passive: false });
  const toggleMagnifiedFrame = (clientX, clientY) => {
    if (!state.diff.magnifier) return;
    state.diff.magnifierShowsTarget = !state.diff.magnifierShowsTarget;
    const rect = stage.getBoundingClientRect();
    positionLens(clientX - rect.left, clientY - rect.top, rect);
  };
  stage.addEventListener("click", (e) => {
    if (e.target.closest("#diff-handle")) return;
    toggleMagnifiedFrame(e.clientX, e.clientY);
  });
}

$("#diff-magnifier").addEventListener("change", (e) => {
  state.diff.magnifier = e.target.checked;
  $("#diff-lens").hidden = !state.diff.magnifier;
});

document.addEventListener("keydown", (e) => {
  if (!$('.panel[data-panel="preview"]').classList.contains("is-active")) return;
  const tag = document.activeElement?.tagName || "";
  if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
  if (e.key === "ArrowRight") { stepFrame(1); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { stepFrame(-1); e.preventDefault(); }
  else if (e.key.toLowerCase() === "s") { $("#diff-swap").click(); }
  else if (e.key.toLowerCase() === "f") { $("#diff-fullscreen").click(); }
});

$("#thumb-generate").addEventListener("click", generateThumbnails);

bindInputs();
render();
connectEvents();

api("/api/config").then((cfg) => { state.config = cfg; renderQueueSettings(); }).catch(() => {});
loadPresets().then(() => {
  const first = state.presets.find((p) => p.id === "general-1080p30") || state.presets[0];
  if (first) applyPreset(first);
}).catch((err) => toast(err.message));
