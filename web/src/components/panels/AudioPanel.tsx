import { useRef } from "react";
import { useStore } from "../../store";
import { toast, upload } from "../../api";
import type { AddedTrack, Track } from "../../types";

function trackLabel(t: Track): string {
  return [
    `${t.index + 1}. ${t.codec}`,
    t.language,
    t.channels ? `${t.channels}ch` : "",
    t.title,
  ]
    .filter(Boolean)
    .join(" \u00b7 ");
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function AudioPanel() {
  const source = useStore((s) => s.source);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const openBrowser = useStore((s) => s.openBrowser);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = settings;
  const isCopy = s.audio.encoder === "copy";

  const tracks = s.audio.tracks ?? [];
  const extra = s.audio.extra ?? [];
  const sourceTracks = source?.audio ?? [];
  const keep = sourceTracks.filter((t) => tracks.includes(t.index));
  const available = sourceTracks.filter((t) => !tracks.includes(t.index));

  // An added or removed track only takes effect when the audio is re-encoded,
  // so a "keep original" or "no audio" pick is nudged to AAC as soon as the
  // user starts shaping the track list.
  const ensureEncoded = () => {
    if (s.audio.encoder === "none" || s.audio.encoder === "copy") {
      updateSettings("audio.encoder", "aac");
    }
  };

  const removeTrack = (index: number) =>
    updateSettings(
      "audio.tracks",
      tracks.filter((i) => i !== index),
    );

  const addTrack = (index: number) => {
    if (tracks.includes(index)) return;
    ensureEncoded();
    updateSettings("audio.tracks", [...tracks, index].sort((a, b) => a - b));
  };

  const setExtra = (list: AddedTrack[]) => updateSettings("audio.extra", list);

  const addExtra = (track: AddedTrack) => {
    ensureEncoded();
    setExtra([...extra, track]);
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const info = await upload(file);
      addExtra({ path: info.path, title: file.name.replace(/\.[^.]+$/, "") });
      toast(`${file.name} added`, true);
    } catch (err: unknown) {
      toast((err as Error).message);
    }
  };

  return (
    <section className="panel is-active">
      <div className="track-list">
        <p className="track-list-title">Audio tracks to keep</p>
        {keep.length || extra.length ? (
          <ul className="track-rows">
            {keep.map((t) => (
              <li key={`s${t.index}`} className="track-row">
                <span className="track-name">{trackLabel(t)}</span>
                <span className="track-tag">from the file</span>
                <button
                  className="btn btn-quiet track-remove"
                  title="Remove this track"
                  onClick={() => removeTrack(t.index)}
                >
                  {"\u00d7"}
                </button>
              </li>
            ))}
            {extra.map((t, i) => (
              <li key={`x${i}`} className="track-row">
                <span className="track-name">{baseName(t.path)}</span>
                <input
                  className="track-lang"
                  type="text"
                  placeholder="language"
                  value={t.language ?? ""}
                  onChange={(e) => {
                    const list = extra.slice();
                    list[i] = { ...list[i], language: e.target.value };
                    setExtra(list);
                  }}
                />
                <button
                  className="btn btn-quiet track-remove"
                  title="Remove this track"
                  onClick={() => setExtra(extra.filter((_, j) => j !== i))}
                >
                  {"\u00d7"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">No audio track will be written.</p>
        )}
        <div className="track-add">
          <select
            value=""
            disabled={!available.length}
            onChange={(e) => {
              if (e.target.value !== "") addTrack(Number(e.target.value));
            }}
          >
            <option value="">
              {available.length
                ? "Add a track from the file\u2026"
                : "Every track is already included"}
            </option>
            {available.map((t) => (
              <option key={t.index} value={t.index}>
                {trackLabel(t)}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={() => openBrowser("audio", "audio")}
            title="Add an audio file from the source folder"
          >
            Add from a file{"\u2026"}
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Upload{"\u2026"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.m4a,.aac,.ac3,.eac3,.mka,.dts,.flac,.opus"
            hidden
            onChange={onUpload}
          />
        </div>
      </div>

      <div className="grid">
        <label className="field">
          <span>Encoder</span>
          <select
            value={s.audio.encoder}
            onChange={(e) => updateSettings("audio.encoder", e.target.value)}
          >
            <option value="aac">AAC</option>
            <option value="opus">Opus</option>
            <option value="mp3">MP3</option>
            <option value="ac3">AC3</option>
            <option value="flac">FLAC (lossless)</option>
            <option value="copy">Keep original audio</option>
            <option value="none">No audio</option>
          </select>
        </label>
        {!isCopy && (
          <>
            <label className="field">
              <span>Bitrate (kbit/s)</span>
              <select
                value={s.audio.bitrate}
                onChange={(e) =>
                  updateSettings("audio.bitrate", Number(e.target.value))
                }
              >
                {[64, 96, 128, 160, 192, 256, 320].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Channels</span>
              <select
                value={s.audio.mixdown}
                onChange={(e) => updateSettings("audio.mixdown", e.target.value)}
              >
                <option value="source">Same as source</option>
                <option value="mono">Mono</option>
                <option value="stereo">Stereo</option>
                <option value="5.1">5.1 surround</option>
              </select>
            </label>
            <label className="field">
              <span>Sample rate</span>
              <select
                value={s.audio.sampleRate}
                onChange={(e) =>
                  updateSettings("audio.sampleRate", Number(e.target.value))
                }
              >
                <option value={0}>Same as source</option>
                <option value={44100}>44.1 kHz</option>
                <option value={48000}>48 kHz</option>
              </select>
            </label>
            <label className="field">
              <span>Gain (dB)</span>
              <input
                type="number"
                min={-20}
                max={20}
                step={0.5}
                value={s.audio.gain}
                onChange={(e) =>
                  updateSettings("audio.gain", Number(e.target.value))
                }
              />
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={s.audio.normalize}
                onChange={(e) =>
                  updateSettings("audio.normalize", e.target.checked)
                }
              />
              <span>Even out loudness across the whole file</span>
            </label>
          </>
        )}
      </div>
      {isCopy && extra.length > 0 && (
        <p className="note">
          Added files are re-encoded as AAC; the tracks from the source file are
          still kept as they are.
        </p>
      )}
    </section>
  );
}
