import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { api, scan, toast } from "../../api";
import { formatBytes } from "../../utils";
import type { ScanResponse } from "../../types";

export function BatchEncode() {
  const batchOpen = useStore((s) => s.batchOpen);
  const batchDir = useStore((s) => s.batchDir);
  const setBatchOpen = useStore((s) => s.setBatchOpen);
  const presets = useStore((s) => s.presets);
  const presetId = useStore((s) => s.presetId);

  const [recursive, setRecursive] = useState(true);
  const [rebuildTree, setRebuildTree] = useState(true);
  const [skipExisting, setSkipExisting] = useState(true);
  const [scanData, setScanData] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [queueing, setQueueing] = useState(false);

  const presetName = presets.find((p) => p.id === presetId)?.name || "custom settings";

  useEffect(() => {
    if (batchOpen && batchDir) {
      refreshScan();
    }
  }, [batchOpen, batchDir, recursive]);

  const refreshScan = async () => {
    if (!batchDir) return;
    setLoading(true);
    try {
      const data = await scan(batchDir, recursive);
      setScanData(data);
    } catch (err: unknown) {
      toast((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleQueue = async () => {
    if (!batchDir) return;
    setQueueing(true);
    try {
      const settings = useStore.getState().settings;
      const result = await api<{ queued: number; skipped: number }>(
        "/api/batch",
        {
          method: "POST",
          body: JSON.stringify({
            dir: batchDir,
            recursive,
            includeTopFolder: rebuildTree,
            skipExisting,
            spec: settings,
          }),
        },
      );
      setBatchOpen(false);
      toast(
        `Queued ${result.queued} file${result.queued === 1 ? "" : "s"}` +
          (result.skipped ? `, skipped ${result.skipped} already done` : ""),
        true,
      );
    } catch (err: unknown) {
      toast((err as Error).message);
    } finally {
      setQueueing(false);
    }
  };

  if (!batchOpen) return null;

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) setBatchOpen(false);
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="batch-title">
        <header className="modal-head">
          <h2 id="batch-title">Encode a whole folder</h2>
          <button className="btn btn-quiet" onClick={() => setBatchOpen(false)}>
            Close
          </button>
        </header>
        <div className="modal-body">
          <p className="browser-path">{batchDir}</p>
          <div className="grid">
            <label className="field check">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
              />
              <span>Include subfolders</span>
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={rebuildTree}
                onChange={(e) => setRebuildTree(e.target.checked)}
              />
              <span>Rebuild the same folder tree in the output</span>
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={skipExisting}
                onChange={(e) => setSkipExisting(e.target.checked)}
              />
              <span>Skip files that already have a result</span>
            </label>
          </div>
          <p className="note">
            {loading
              ? "Scanning\u2026"
              : scanData
                ? `${scanData.count} video${scanData.count === 1 ? "" : "s"}, ${formatBytes(scanData.totalSize)} in total.`
                : ""}
          </p>
          {scanData && (
            <ul className="browser-list batch-preview">
              {scanData.files.slice(0, 200).map((f) => (
                <li key={f.path}>{f.rel}</li>
              ))}
              {scanData.count > 200 && (
                <li>{"\u2026"}and {scanData.count - 200} more</li>
              )}
            </ul>
          )}
        </div>
        <footer className="modal-foot">
          <span className="queue-summary">Using {presetName}</span>
          <button
            className="btn btn-primary"
            disabled={!scanData || scanData.count === 0 || queueing}
            onClick={handleQueue}
          >
            {queueing ? "Queueing\u2026" : "Queue them all"}
          </button>
        </footer>
      </div>
    </div>
  );
}
