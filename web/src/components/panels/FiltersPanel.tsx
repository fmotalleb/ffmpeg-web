import { useStore } from "../../store";

export function FiltersPanel() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const s = settings;

  return (
    <section className="panel is-active">
      <div className="grid">
        <label className="field">
          <span>Deinterlace</span>
          <select
            value={s.filters.deinterlace}
            onChange={(e) => updateSettings("filters.deinterlace", e.target.value)}
          >
            <option value="off">Off</option>
            <option value="yadif">Yadif</option>
            <option value="bwdif">Bwdif (better)</option>
          </select>
        </label>
        <label className="field">
          <span>Reduce noise</span>
          <select
            value={s.filters.denoise}
            onChange={(e) => updateSettings("filters.denoise", e.target.value)}
          >
            <option value="off">Off</option>
            <option value="light">Light</option>
            <option value="medium">Medium</option>
            <option value="strong">Strong</option>
          </select>
        </label>
        <label className="field">
          <span>Rotate</span>
          <select
            value={s.filters.rotate}
            onChange={(e) =>
              updateSettings("filters.rotate", Number(e.target.value))
            }
          >
            <option value={0}>None</option>
            <option value={90}>90{"\u00b0"} clockwise</option>
            <option value={180}>180{"\u00b0"}</option>
            <option value={270}>90{"\u00b0"} counter-clockwise</option>
          </select>
        </label>
        <label className="field check">
          <input
            type="checkbox"
            checked={s.filters.flipH}
            onChange={(e) => updateSettings("filters.flipH", e.target.checked)}
          />
          <span>Mirror horizontally</span>
        </label>
        <label className="field check">
          <input
            type="checkbox"
            checked={s.filters.sharpen}
            onChange={(e) => updateSettings("filters.sharpen", e.target.checked)}
          />
          <span>Sharpen</span>
        </label>
        <label className="field check">
          <input
            type="checkbox"
            checked={s.filters.deblock}
            onChange={(e) => updateSettings("filters.deblock", e.target.checked)}
          />
          <span>Smooth out blocky compression</span>
        </label>
        <label className="field check">
          <input
            type="checkbox"
            checked={s.filters.grayscale}
            onChange={(e) =>
              updateSettings("filters.grayscale", e.target.checked)
            }
          />
          <span>Black and white</span>
        </label>
      </div>
      {s.video.encoder === "copy" && (
        <p className="note">
          Filters are ignored while the original video is kept as-is.
        </p>
      )}
    </section>
  );
}
