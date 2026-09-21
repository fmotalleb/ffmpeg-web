import { useStore } from "../../store";

export function AudioPanel() {
  const source = useStore((s) => s.source);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const s = settings;
  const isCopy = s.audio.encoder === "copy";

  return (
    <section className="panel is-active">
      <div className="grid">
        <label className="field">
          <span>Track</span>
          <select
            value={s.audio.track}
            onChange={(e) => updateSettings("audio.track", Number(e.target.value))}
          >
            {source && source.audio.length > 0 ? (
              source.audio.map((t) => (
                <option key={t.index} value={t.index}>
                  {t.index + 1}. {t.codec}
                  {t.language ? " \u00b7 " + t.language : ""}
                  {t.channels ? " \u00b7 " + t.channels + "ch" : ""}
                  {t.title ? " \u00b7 " + t.title : ""}
                </option>
              ))
            ) : (
              <option value={0}>no audio in this file</option>
            )}
          </select>
        </label>
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
    </section>
  );
}
