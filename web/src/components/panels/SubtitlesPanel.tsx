import { useRef } from "react";
import { useStore } from "../../store";
import { toast, upload } from "../../api";
import type { AddedTrack, Track } from "../../types";

function trackLabel(t: Track): string {
  return [`${t.index + 1}. ${t.codec}`, t.language, t.title]
    .filter(Boolean)
    .join(" \u00b7 ");
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function SubtitlesPanel() {
  const source = useStore((s) => s.source);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const openBrowser = useStore((s) => s.openBrowser);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = settings;

  const copying = s.subtitle.mode === "copy";
  const tracks = s.subtitle.tracks ?? [];
  const extra = s.subtitle.extra ?? [];
  const sourceTracks = source?.subtitles ?? [];
  const keep = sourceTracks.filter((t) => tracks.includes(t.index));
  const available = sourceTracks.filter((t) => !tracks.includes(t.index));

  const removeTrack = (index: number) =>
    updateSettings(
      "subtitle.tracks",
      tracks.filter((i) => i !== index),
    );

  const addTrack = (index: number) => {
    if (tracks.includes(index)) return;
    updateSettings("subtitle.tracks", [...tracks, index].sort((a, b) => a - b));
  };

  const setExtra = (list: AddedTrack[]) => updateSettings("subtitle.extra", list);

  const addExtra = (track: AddedTrack) => setExtra([...extra, track]);

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
      <div className="grid">
        <label className="field">
          <span>What to do with subtitles</span>
          <select
            value={s.subtitle.mode}
            onChange={(e) => updateSettings("subtitle.mode", e.target.value)}
          >
            <option value="none">Leave them out</option>
            <option value="copy">Keep as selectable tracks</option>
            <option value="burn">Burn into the picture</option>
          </select>
        </label>
        {s.subtitle.mode === "burn" && (
          <label className="field">
            <span>Track to burn in</span>
            <select
              value={s.subtitle.track}
              onChange={(e) =>
                updateSettings("subtitle.track", Number(e.target.value))
              }
            >
              {sourceTracks.length > 0 ? (
                sourceTracks.map((t) => (
                  <option key={t.index} value={t.index}>
                    {trackLabel(t)}
                  </option>
                ))
              ) : (
                <option value={0}>no subtitles in this file</option>
              )}
            </select>
          </label>
        )}
      </div>

      {copying && (
        <div className="track-list">
          <p className="track-list-title">Subtitle tracks to keep</p>
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
            <p className="note">No subtitle track will be written.</p>
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
              onClick={() => openBrowser("subtitle", "subtitle")}
              title="Add a subtitle file from the source folder"
            >
              Add from a file{"\u2026"}
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Upload{"\u2026"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".srt,.ass,.ssa,.vtt,.sub,.sup,.smi,.idx"
              hidden
              onChange={onUpload}
            />
          </div>
        </div>
      )}

      <p className="note">
        MP4 only carries text subtitles. Picture subtitles from a DVD or Blu-ray
        need MKV, or burning in.
      </p>
    </section>
  );
}
