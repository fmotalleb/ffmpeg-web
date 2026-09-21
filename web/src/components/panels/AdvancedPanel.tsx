import { useEffect, useRef } from "react";
import { useStore } from "../../store";
import { api } from "../../api";

export function AdvancedPanel() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cmdRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    clearTimeout(previewTimerRef.current as ReturnType<typeof setTimeout> | undefined);
    previewTimerRef.current = setTimeout(async () => {
      if (!cmdRef.current) return;
      try {
        const data = await api<{ bin: string; args: string[] }>(
          "/api/preview",
          { method: "POST", body: JSON.stringify(settings) },
        );
        if (cmdRef.current) {
          cmdRef.current.textContent = "";
          const bin = document.createElement("b");
          bin.textContent = data.bin;
          cmdRef.current.append(
            bin,
            " " +
              data.args
                .map((a) => (/\s/.test(a) ? `"${a}"` : a))
                .join(" "),
          );
        }
      } catch (err: unknown) {
        if (cmdRef.current) cmdRef.current.textContent = (err as Error).message;
      }
    }, 250);
    return () => clearTimeout(previewTimerRef.current);
  }, [settings]);

  return (
    <section className="panel is-active">
      <p className="note">
        These go straight to ffmpeg. They are not checked beyond quoting, so a
        typo here shows up as a failed job with the ffmpeg error attached.
      </p>
      <div className="grid">
        <label className="field field-wide">
          <span>
            Encoder options{" "}
            <em className="hint">
              x264, x265 and AV1 only —{" "}
              <code>keyint=240:ref=4</code>
            </em>
          </span>
          <input
            type="text"
            value={settings.extra.encoderOptions}
            onChange={(e) =>
              updateSettings("extra.encoderOptions", e.target.value)
            }
            placeholder="keyint=240:bframes=3"
          />
        </label>
        <label className="field field-wide">
          <span>Extra options before the input</span>
          <input
            type="text"
            value={settings.extra.inputArgs}
            onChange={(e) => updateSettings("extra.inputArgs", e.target.value)}
            placeholder="-hwaccel auto"
          />
        </label>
        <label className="field field-wide">
          <span>Extra options before the output</span>
          <input
            type="text"
            value={settings.extra.outputArgs}
            onChange={(e) => updateSettings("extra.outputArgs", e.target.value)}
            placeholder='-metadata title="My film" -map_chapters 0'
          />
        </label>
      </div>
      <h3 className="group-title">Command that will run</h3>
      <pre ref={cmdRef} className="cmd-preview" />
    </section>
  );
}
