import { useStore } from "../../store";

export function SubtitlesPanel() {
  const source = useStore((s) => s.source);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const s = settings;

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
            <option value="copy">Keep as a selectable track</option>
            <option value="burn">Burn into the picture</option>
          </select>
        </label>
        {s.subtitle.mode !== "none" && (
          <label className="field">
            <span>Track</span>
            <select
              value={s.subtitle.track}
              onChange={(e) =>
                updateSettings("subtitle.track", Number(e.target.value))
              }
            >
              {source && source.subtitles.length > 0 ? (
                source.subtitles.map((t) => (
                  <option key={t.index} value={t.index}>
                    {t.index + 1}. {t.codec}
                    {t.language ? " \u00b7 " + t.language : ""}
                    {t.title ? " \u00b7 " + t.title : ""}
                  </option>
                ))
              ) : (
                <option value={0}>no subtitles in this file</option>
              )}
            </select>
          </label>
        )}
      </div>
      <p className="note">
        MP4 only carries text subtitles. Picture subtitles from a DVD or Blu-ray
        need MKV, or burning in.
      </p>
    </section>
  );
}
