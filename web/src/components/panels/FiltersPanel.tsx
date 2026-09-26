import { useStore } from "../../store";
import type { ColorSpec } from "../../types";

const NO_COLOR: ColorSpec = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 0,
  hue: 0,
};

// The four eq properties plus hue, with the label and the range each uses.
const COLOR_FIELDS: { key: keyof ColorSpec; label: string; min: number; max: number }[] = [
  { key: "brightness", label: "Brightness", min: -100, max: 100 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
  { key: "gamma", label: "Gamma", min: -100, max: 100 },
  { key: "hue", label: "Hue (degrees)", min: -180, max: 180 },
];

export function FiltersPanel() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const s = settings;
  const color = s.filters.color ?? NO_COLOR;
  const touched = COLOR_FIELDS.some((f) => color[f.key] !== 0);

  const setColor = (key: keyof ColorSpec, value: number) =>
    updateSettings("filters.color", { ...color, [key]: value });

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
          <span>Deband (smooth colour steps)</span>
          <select
            value={s.filters.deband}
            onChange={(e) => updateSettings("filters.deband", e.target.value)}
          >
            <option value="off">Off</option>
            <option value="light">Light</option>
            <option value="medium">Medium</option>
            <option value="strong">Strong</option>
          </select>
        </label>
        <label className="field">
          <span>Blur (soften the picture)</span>
          <select
            value={s.filters.blur}
            onChange={(e) => updateSettings("filters.blur", e.target.value)}
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
        <label className="field check">
          <input
            type="checkbox"
            checked={s.filters.tonemap}
            onChange={(e) => updateSettings("filters.tonemap", e.target.checked)}
          />
          <span>HDR to SDR (tone map highlights)</span>
        </label>
      </div>

      <div className="filter-group">
        <p className="filter-group-title">
          Colour
          {touched && (
            <button
              className="btn btn-quiet"
              onClick={() => updateSettings("filters.color", { ...NO_COLOR })}
            >
              Reset
            </button>
          )}
        </p>
        <div className="grid">
          {COLOR_FIELDS.map((f) => (
            <label className="field" key={f.key}>
              <span>{f.label}</span>
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.key === "hue" ? 5 : 2}
                value={color[f.key]}
                onChange={(e) => setColor(f.key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <p className="note">
          Every value is relative to no change: 0 leaves the picture as it is.
        </p>
      </div>

      {s.video.encoder === "copy" && (
        <p className="note">
          Filters are ignored while the original video is kept as-is.
        </p>
      )}
    </section>
  );
}
