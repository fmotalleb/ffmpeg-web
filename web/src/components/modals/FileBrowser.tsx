import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { browse, probe, toast } from "../../api";
import { formatBytes } from "../../utils";
import type { AddedTrack, BrowseResponse } from "../../types";

export function FileBrowser() {
  const browserOpen = useStore((s) => s.browserOpen);
  const browserKind = useStore((s) => s.browserKind);
  const browserTarget = useStore((s) => s.browserTarget);
  const setBrowserOpen = useStore((s) => s.setBrowserOpen);
  const setSource = useStore((s) => s.setSource);
  const updateSettings = useStore((s) => s.updateSettings);
  const settings = useStore((s) => s.settings);
  const setBatchDir = useStore((s) => s.setBatchDir);
  const setBatchOpen = useStore((s) => s.setBatchOpen);

  const [data, setData] = useState<BrowseResponse | null>(null);

  useEffect(() => {
    if (browserOpen) {
      showDirectory("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserOpen, browserKind]);

  const showDirectory = async (path: string) => {
    try {
      const d = await browse(path, browserKind);
      setData(d);
    } catch (err: unknown) {
      toast((err as Error).message);
    }
  };

  const chooseFile = async (path: string) => {
    if (browserTarget === "audio" || browserTarget === "subtitle") {
      const list = (settings[browserTarget].extra ?? []).slice();
      list.push({ path } as AddedTrack);
      updateSettings(`${browserTarget}.extra`, list);
      setBrowserOpen(false);
      return;
    }
    try {
      const info = await probe(path);
      setSource(info);
      setBrowserOpen(false);
    } catch (err: unknown) {
      toast((err as Error).message);
    }
  };

  if (!browserOpen) return null;

  const adding = browserTarget === "audio" || browserTarget === "subtitle";
  const title = adding ? `Add ${browserTarget} from a file` : "Choose a video";
  const empty = adding
    ? `No ${browserTarget} files or subfolders here.`
    : "No videos or subfolders here.";

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) setBrowserOpen(false);
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="browser-title">
        <header className="modal-head">
          <h2 id="browser-title">{title}</h2>
          <button className="btn btn-quiet" onClick={() => setBrowserOpen(false)}>
            Close
          </button>
        </header>
        {data && (
          <>
            <p className="browser-path">{data.path}</p>
            <ul className="browser-list">
              {data.parent && (
                <li>
                  <button onClick={() => showDirectory(data.parent)}>
                    <span className="icon">{"\u2191"}</span>
                    <span className="label">Up one folder</span>
                    <span className="size" />
                  </button>
                </li>
              )}
              {data.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    onClick={() =>
                      entry.dir
                        ? showDirectory(entry.path)
                        : chooseFile(entry.path)
                    }
                  >
                    <span className="icon">
                      {entry.dir ? "\u25b8" : "\u25aa"}
                    </span>
                    <span className="label">{entry.name}</span>
                    <span className="size">
                      {entry.dir ? "" : formatBytes(entry.size)}
                    </span>
                  </button>
                </li>
              ))}
              {!data.entries.length && (
                <li className="browser-path">{empty}</li>
              )}
            </ul>
          </>
        )}
        <footer className="modal-foot">
          <span className="queue-summary">
            {adding
              ? "Pick a file above to add it as an extra track."
              : "Pick a file above, or take the whole folder."}
          </span>
          {!adding && (
            <button
              className="btn"
              onClick={() => {
                setBrowserOpen(false);
                setBatchDir(data?.path || null);
                setBatchOpen(true);
              }}
            >
              Use this folder
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
