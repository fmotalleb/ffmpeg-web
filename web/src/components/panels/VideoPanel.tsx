import { useStore } from "../../store";
import {
  codecForEncoder,
  librariesForCodec,
  qualityScales,
} from "../../utils";

export function VideoPanel() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const encoders = useStore((s) => s.encoders);
  const s = settings;
  const isCopy = s.video.encoder === "copy";

  const codec = codecForEncoder[s.video.encoder];
  const libs = codec ? librariesForCodec(encoders, codec) : [];
  const current =
    libs.find((l) => l.id === s.video.library) ??
    libs.find((l) => l.kind === "cpu") ??
    libs[0];

  // Until the catalog arrives, behave as the software encoders always did.
  const scale = current
    ? { max: current.qualityMax, good: current.qualityGood }
    : qualityScales[s.video.encoder] || qualityScales.x264;
  const speedOk = current ? current.supportsSpeed : true;
  const tuneOk = current ? current.supportsTune : true;
  const levelOk = current ? current.supportsLevel : true;
  const twoPassOk = current ? current.supportsTwoPass : true;

  const kind = current?.kind ?? "cpu";
  const kindLabel =
    encoders.kinds.find((k) => k.id === kind)?.label ??
    (kind === "gpu" ? "GPU (hardware)" : "CPU (software)");
  const kindBlurb = encoders.kinds.find((k) => k.id === kind)?.blurb ?? "";
  const libsOfKind = (k: string) => libs.filter((l) => l.kind === k);

  return (
    <section className="panel is-active">
      <div className="grid">
        <label className="field">
          <span>Encoder</span>
          <select
            value={s.video.encoder}
            onChange={(e) => {
              updateSettings("video.encoder", e.target.value);
              // Libraries do not carry over between codecs, so start over on
              // the software one rather than silently keeping a GPU pick.
              updateSettings("video.library", "sw");
            }}
          >
            <option value="x264">H.264 (x264)</option>
            <option value="x265">H.265 (x265)</option>
            <option value="vp9">VP9</option>
            <option value="av1">AV1 (SVT)</option>
            <option value="copy">Keep original video</option>
          </select>
        </label>
        {!isCopy && libs.length > 0 && (
          <label className="field">
            <span>
              Library <em className="hint">— what does the encoding</em>
            </span>
            <select
              value={current?.id ?? "sw"}
              onChange={(e) => updateSettings("video.library", e.target.value)}
            >
              {encoders.kinds.map((k) => {
                const group = libsOfKind(k.id);
                if (!group.length) return null;
                return (
                  <optgroup key={k.id} label={k.label}>
                    {group.map((l) => (
                      <option key={l.id} value={l.id} disabled={!l.available}>
                        {l.available ? l.name : `${l.name} — ${l.unavailableReason}`}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
        )}
        {!isCopy && current && (
          <div className="field-wide library-info">
            <p className="library-kind">
              <span className={`kind-tag ${kind}`}>{kindLabel}</span>
              {current.available
                ? current.note
                : `${current.unavailableReason} — pick another library.`}
            </p>
            {kindBlurb && current.available && (
              <p className="library-blurb">{kindBlurb}</p>
            )}
            <p className="library-facts">
              <span>
                quality 0–{scale.max}, around {scale.good} is a good default
              </span>
              <span>{twoPassOk ? "two-pass available" : "no two-pass"}</span>
              <span>
                {speedOk ? "speed preset applies" : "no speed preset"}
              </span>
              {!levelOk && <span>no level setting</span>}
              {!tuneOk && <span>no tune setting</span>}
              {current.vendor && <span>{current.vendor}</span>}
            </p>
          </div>
        )}
        {!isCopy && speedOk && (
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
                  checked={s.video.twoPass && twoPassOk}
                  disabled={!twoPassOk}
                  onChange={(e) =>
                    updateSettings("video.twoPass", e.target.checked)
                  }
                />
                <span>
                  {twoPassOk
                    ? "Two passes — slower, hits the target more accurately"
                    : `Two passes need a software encoder; ${current?.name ?? "this library"} cannot do them`}
                </span>
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
                disabled={!levelOk}
                title={levelOk ? undefined : `${current?.name ?? "This library"} has no level setting`}
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
                disabled={!tuneOk}
                title={tuneOk ? undefined : `${current?.name ?? "This library"} has no tune setting`}
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
