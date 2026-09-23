import { useRef } from "react";
import { useStore } from "../store";
import { api, toast } from "../api";
import { HardwareStatus } from "./HardwareStatus";
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

  const handleFolder = () => {
    setBrowserOpen(true);
    // The browser component handles the "use this folder" flow
    // We set a flag so when a folder is chosen from the browser, it opens batch
    useStore.setState({ batchDir: useStore.getState().browserDir });
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">FFMPEG-Web</span>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={() => setBrowserOpen(true)}>
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
                settings.input = useStore.getState().source!.path;
                api("/api/jobs", {
                  method: "POST",
                  body: JSON.stringify(settings),
                })
                  .then(() => toast("Added to the queue", true))
                  .catch((err) => toast(err.message));
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
