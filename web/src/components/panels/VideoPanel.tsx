import { useStore } from "../../store";
import { qualityScales } from "../../utils";

export function VideoPanel() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const s = settings;
  const scale = qualityScales[s.video.encoder] || qualityScales.x264;
  const isCopy = s.video.encoder === "copy";

  return (
    <section className="panel is-active">
      <div className="grid">
        <label className="field">
          <span>Encoder</span>
          <select
            value={s.video.encoder}
            onChange={(e) => updateSettings("video.encoder", e.target.value)}
          >
            <option value="x264">H.264 (x264)</option>
            <option value="x265">H.265 (x265)</option>
            <option value="vp9">VP9</option>
            <option value="av1">AV1 (SVT)</option>
            <option value="copy">Keep original video</option>
          </select>
        </label>
        {!isCopy && (
          <label className="field">
            <span>Encoder speed</span>
            <select
              value={s.video.speed}
              onChange={(e) => updateSettings("video.speed", e.target.value)}
            >
              {["ultrafast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"].map(
                (v) => (
                  <option key={v} value={v}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        {!isCopy && (
          <label className="field">
            <span>Framerate</span>
            <select
              value={s.video.fpsMode}
              onChange={(e) => updateSettings("video.fpsMode", e.target.value)}
            >
              <option value="same">Same as source</option>
              <option value="peak">Cap at</option>
              <option value="constant">Force constant</option>
            </select>
          </label>
        )}
        {s.video.fpsMode !== "same" && (
          <label className="field">
            <span>Frames per second</span>
            <select
              value={s.video.fps}
              onChange={(e) => updateSettings("video.fps", e.target.value)}
            >
              {["23.976", "24", "25", "30", "50", "60"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!isCopy && (
        <>
          <h3 className="group-title">Quality</h3>
          <div className="segmented" role="group" aria-label="Rate control">
            <button
              className={`seg${s.video.rateMode === "quality" ? " is-active" : ""}`}
              onClick={() => updateSettings("video.rateMode", "quality")}
            >
              Constant quality
            </button>
            <button
              className={`seg${s.video.rateMode === "bitrate" ? " is-active" : ""}`}
              onClick={() => updateSettings("video.rateMode", "bitrate")}
            >
              Target bitrate
            </button>
          </div>

          {s.video.rateMode === "quality" && (
            <div className="grid">
              <div className="field field-wide">
                <span>
                  Quality{" "}
                  <em className="hint">
                    — {scale.good} is a good default for this encoder
                  </em>
                </span>
                <div className="slider-row">
                  <input
                    type="range"
                    min={0}
                    max={scale.max}
                    step={1}
                    value={s.video.quality}
                    onChange={(e) =>
                      updateSettings("video.quality", Number(e.target.value))
                    }
                  />
                  <output className="readout">{s.video.quality}</output>
                </div>
                <p className="scale-legend">
                  <span>bigger file, looks better</span>
                  <span>smaller file, looks worse</span>
                </p>
              </div>
            </div>
          )}

          {s.video.rateMode === "bitrate" && (
            <div className="grid">
              <label className="field">
                <span>Video bitrate (kbit/s)</span>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={s.video.bitrate}
                  onChange={(e) =>
                    updateSettings("video.bitrate", Number(e.target.value))
                  }
                />
              </label>
              <label className="field check">
                <input
                  type="checkbox"
                  checked={s.video.twoPass}
                  onChange={(e) =>
                    updateSettings("video.twoPass", e.target.checked)
                  }
                />
                <span>Two passes — slower, hits the target more accurately</span>
              </label>
              <p className="field field-wide note" id="size-estimate" />
            </div>
          )}

          <h3 className="group-title">Compatibility</h3>
          <div className="grid">
            <label className="field">
              <span>Profile</span>
              <select
                value={s.video.profile}
                onChange={(e) => updateSettings("video.profile", e.target.value)}
              >
                <option value="auto">Automatic</option>
                <option value="baseline">Baseline</option>
                <option value="main">Main</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="field">
              <span>Level</span>
              <select
                value={s.video.level}
                onChange={(e) => updateSettings("video.level", e.target.value)}
              >
                <option value="auto">Automatic</option>
                {["3.0", "3.1", "4.0", "4.1", "5.0", "5.1"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tune</span>
              <select
                value={s.video.tune}
                onChange={(e) => updateSettings("video.tune", e.target.value)}
              >
                <option value="none">None</option>
                <option value="film">Film</option>
                <option value="animation">Animation</option>
                <option value="grain">Grain</option>
                <option value="fastdecode">Fast decode</option>
                <option value="zerolatency">Zero latency</option>
              </select>
            </label>
            <label className="field">
              <span>Keyframe every (frames)</span>
              <input
                type="number"
                min={0}
                step={1}
                value={s.video.gop || ""}
                onChange={(e) =>
                  updateSettings("video.gop", Number(e.target.value) || 0)
                }
                placeholder="encoder default"
              />
            </label>
          </div>
        </>
      )}
    </section>
  );
}
