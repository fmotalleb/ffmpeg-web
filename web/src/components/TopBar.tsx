import { useRef } from "react";
import { useStore } from "../store";
import { ApiError, api, toast } from "../api";
import { HardwareStatus } from "./hardware";
import { Icon } from "./icons";
import type { MediaInfo } from "../types";

export function TopBar() {
  const source = useStore((s) => s.source);
  const editingJobId = useStore((s) => s.editingJobId);
  const setBrowserOpen = useStore((s) => s.setBrowserOpen);
  const setSource = useStore((s) => s.setSource);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const info = await api<MediaInfo>("/api/upload", {
        method: "POST",
        body: (() => {
          const fd = new FormData();
          fd.append("file", file);
          return fd;
        })(),
      });
      setSource(info);
      toast(`${info.name} is ready to encode`, true);
    } catch (err: unknown) {
      toast((err as Error).message);
    }
  };

  // A queued name that is already taken comes back as a refusal rather than a
  // silent rename to "name (1)", so ask which one the user meant: write over
  // what is there, or leave the queue alone. Overwriting the source itself is
  // safe by construction — that run encodes elsewhere and swaps on success.
  const queue = async (overwrite: boolean) => {
    const { settings, source: chosen } = useStore.getState();
    if (!chosen) return;
    settings.input = chosen.path;
    await api(`/api/jobs${overwrite ? "?overwrite=1" : ""}`, {
      method: "POST",
      body: JSON.stringify(settings),
    });
  };

  const handleQueue = async () => {
    try {
      await queue(false);
      toast("Added to the queue", true);
      return;
    } catch (err: unknown) {
      if (!(err instanceof ApiError) || !err.code.startsWith("output-")) {
        toast((err as Error).message);
        return;
      }
      const question =
        err.code === "output-is-source"
          ? `${err.message}. The encode is written elsewhere first and swapped in when it finishes, so a failed run leaves the original alone.\n\nReplace it with the result?`
          : `${err.message}. The existing file is written straight over — if the encode falls short, what was there is gone.\n\nOverwrite it?`;
      if (!confirm(question)) return; // cancel: nothing is queued
      try {
        await queue(true);
        toast("Added to the queue, replacing the file that was there", true);
      } catch (retryErr: unknown) {
        toast((retryErr as Error).message);
      }
    }
  };

  const handleFolder = () => {
    setBrowserOpen(true);
    // The browser component handles the "use this folder" flow
    // We set a flag so when a folder is chosen from the browser, it opens batch
    useStore.setState({ batchDir: useStore.getState().browserDir });
  };

  const handleChooseFile = () => {
    // When choosing a video file, we want to browse video files and target the source.
    // This is different from adding extra audio/subtitle tracks.
    useStore.setState({
      browserOpen: true,
      browserKind: "video",
      browserTarget: "source",
    });
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">FFMPEG-Web</span>
        </div>
        <a
          className="btn btn-star"
          href="https://github.com/fmotalleb/ffmpeg-web"
          target="_blank"
          rel="noopener noreferrer"
          title="Star the project on GitHub"
        >
          <Icon name="star" />
          Star the project
        </a>
        <div className="topbar-actions">
          <button className="btn" onClick={handleChooseFile}>
            Choose file on server
          </button>
          <button className="btn" onClick={handleFolder}>
            Encode a folder
          </button>
          <button
            className="btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload a file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mkv,.ts,.m2ts"
            hidden
            onChange={handleUpload}
          />
          <span className="spacer" />
          <HardwareStatus />
          <button
            className="btn btn-primary"
            disabled={!source}
            onClick={() => {
              // Queue or save edits
              const { editingJobId, settings } = useStore.getState();
              if (editingJobId) {
                api(`/api/jobs/${editingJobId}`, {
                  method: "PUT",
                  body: JSON.stringify(settings),
                })
                  .then(() => {
                    toast("Job updated", true);
                    useStore.setState({ editingJobId: null });
                  })
                  .catch((err) => toast(err.message));
              } else {
                void handleQueue();
              }
            }}
          >
            {editingJobId ? "Save changes" : "Add to queue"}
          </button>
        </div>
      </header>
      {editingJobId && (
        <div className="banner">
          <span className="banner-text">
            Editing a queued job — changes apply when you save.
          </span>
          <span className="spacer" />
          <button
            className="btn btn-small btn-quiet"
            onClick={() => useStore.setState({ editingJobId: null })}
          >
            Cancel edit
          </button>
        </div>
      )}
    </>
  );
}
