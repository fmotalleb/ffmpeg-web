import { useStore } from "../../store";

export function DimensionsPanel() {
  const source = useStore((s) => s.source);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const s = settings;
  const isCustom = s.picture.scaleMode === "custom";

  const outputDims = (() => {
    if (!source || !source.video) return null;
    let w = source.video.width - s.picture.cropLeft - s.picture.cropRight;
    let h = source.video.height - s.picture.cropTop - s.picture.cropBottom;
    if (w <= 0 || h <= 0) return null;
    if (isCustom && s.picture.width > 0 && s.picture.height > 0) {
      if (s.picture.keepAspect && !s.picture.pad) {
        const ratio = Math.min(s.picture.width / w, s.picture.height / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      } else {
        w = s.picture.width;
        h = s.picture.height;
      }
    }
    if (s.filters.rotate % 180 === 90) [w, h] = [h, w];
    return { w: w - (w % 2), h: h - (h % 2) };
  })();

  return (
    <section className="panel is-active">
      <div className="grid">
        <label className="field">
          <span>Size</span>
          <select
            value={s.picture.scaleMode}
            onChange={(e) => updateSettings("picture.scaleMode", e.target.value)}
          >
            <option value="source">Same as source</option>
            <option value="custom">Resize to</option>
          </select>
        </label>
        {isCustom && (
          <>
            <label className="field">
              <span>Width</span>
              <input
                type="number"
                min={16}
                step={2}
                value={s.picture.width}
                onChange={(e) =>
                  updateSettings("picture.width", Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              <span>Height</span>
              <input
                type="number"
                min={16}
                step={2}
                value={s.picture.height}
                onChange={(e) =>
                  updateSettings("picture.height", Number(e.target.value))
                }
              />
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={s.picture.keepAspect}
                onChange={(e) =>
                  updateSettings("picture.keepAspect", e.target.checked)
                }
              />
              <span>Keep the original shape</span>
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={s.picture.pad}
                onChange={(e) => updateSettings("picture.pad", e.target.checked)}
              />
              <span>Fill the leftover space with black bars</span>
            </label>
          </>
        )}
        <label className="field">
          <span>Colour depth</span>
          <select
            value={s.picture.pixelFormat}
            onChange={(e) =>
              updateSettings("picture.pixelFormat", e.target.value)
            }
          >
            <option value="">Same as source</option>
            <option value="yuv420p">8-bit</option>
            <option value="yuv420p10le">10-bit</option>
          </select>
        </label>
      </div>

      <h3 className="group-title">Crop</h3>
      <div className="crop">
        <div className="crop-frame" aria-hidden="true">
          <div
            className="crop-preview"
            style={{
              inset: source?.video
                ? `${Math.min(45, (s.picture.cropTop / Math.max(source.video.height, 1)) * 100)}% ${Math.min(45, (s.picture.cropRight / Math.max(source.video.width, 1)) * 100)}% ${Math.min(45, (s.picture.cropBottom / Math.max(source.video.height, 1)) * 100)}% ${Math.min(45, (s.picture.cropLeft / Math.max(source.video.width, 1)) * 100)}%`
                : "0",
            }}
          />
        </div>
        <div className="crop-fields">
          <label className="field">
            <span>Top</span>
            <input
              type="number"
              min={0}
              step={2}
              value={s.picture.cropTop}
              onChange={(e) =>
                updateSettings("picture.cropTop", Number(e.target.value))
              }
            />
          </label>
          <label className="field">
            <span>Bottom</span>
            <input
              type="number"
              min={0}
              step={2}
              value={s.picture.cropBottom}
              onChange={(e) =>
                updateSettings("picture.cropBottom", Number(e.target.value))
              }
            />
          </label>
          <label className="field">
            <span>Left</span>
            <input
              type="number"
              min={0}
              step={2}
              value={s.picture.cropLeft}
              onChange={(e) =>
                updateSettings("picture.cropLeft", Number(e.target.value))
              }
            />
          </label>
          <label className="field">
            <span>Right</span>
            <input
              type="number"
              min={0}
              step={2}
              value={s.picture.cropRight}
              onChange={(e) =>
                updateSettings("picture.cropRight", Number(e.target.value))
              }
            />
          </label>
        </div>
      </div>
      <p className="note">
        {outputDims
          ? `The finished video will be ${outputDims.w}\u00d7${outputDims.h} pixels.`
          : source
            ? "Those crop values remove the whole picture."
            : ""}
      </p>
    </section>
  );
}
