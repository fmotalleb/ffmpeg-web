import { useStore } from "../store";
import { api, toast } from "../api";
import { JobRow } from "./JobRow";
import { formatDuration } from "../utils";

export function Queue() {
  const jobs = useStore((s) => s.jobs);
  const queue = useStore((s) => s.queue);
  const queueSettingsOpen = useStore((s) => s.queueSettingsOpen);
  const setQueueSettingsOpen = useStore((s) => s.setQueueSettingsOpen);
  const setQueuePaused = useStore((s) => s.setQueuePaused);

  const jobsArray = Array.from(jobs.values());

  const count = (status: string) => jobsArray.filter((j) => j.status === status).length;
  const waiting = count("queued");
  const remaining = jobsArray
    .filter((j) => j.status === "queued" || j.status === "running")
    .reduce((acc, j) => acc + (j.eta > 0 ? j.eta : 0), 0);

  const summary = jobsArray.length
    ? `${count("running")} encoding \u00b7 ${waiting} waiting \u00b7 ${count("done")} done` +
      `${count("failed") ? ` \u00b7 ${count("failed")} failed` : ""}` +
      `${remaining > 0 ? ` \u00b7 about ${formatDuration(remaining)} left on the current file` : ""}` +
      `${queue.paused ? " \u00b7 paused" : ""}`
    : queue.paused
      ? "paused"
      : "";

  return (
    <section className="queue" aria-label="Queue">
      <header className="queue-head">
        <h2>Queue</h2>
        <span className="queue-summary">{summary}</span>
        <button
          className={`btn btn-small${queue.paused ? " btn-primary" : ""}`}
          onClick={() => {
            api("/api/queue/pause", {
              method: "POST",
              body: JSON.stringify({ paused: !queue.paused }),
            })
              .then(() => setQueuePaused(!queue.paused))
              .catch((err) => toast(err.message));
          }}
        >
          {queue.paused ? "Resume" : "Pause"}
        </button>
        <button
          className="btn btn-small btn-quiet"
          onClick={() => setQueueSettingsOpen(!queueSettingsOpen)}
        >
          Options
        </button>
        <button
          className="btn btn-small btn-quiet"
          onClick={() => {
            window.location.href = "/api/queue/export";
          }}
        >
          Export
        </button>
        <button
          className="btn btn-small btn-quiet"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json,.json";
            input.onchange = async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (!file) return;
              try {
                const result = await api<{ added: number; rejected: string[] }>(
                  "/api/queue/import",
                  { method: "POST", body: await file.text() },
                );
                toast(
                  `Imported ${result.added} job${result.added === 1 ? "" : "s"}` +
                    (result.rejected.length
                      ? `, ${result.rejected.length} could not be added`
                      : ""),
                  true,
                );
              } catch (err: unknown) {
                toast((err as Error).message);
              }
            };
            input.click();
          }}
        >
          Import
        </button>
        <button
          className="btn btn-small btn-quiet"
          onClick={async () => {
            const finished = jobsArray.filter((j) =>
              ["done", "failed", "canceled"].includes(j.status),
            );
            for (const job of finished) {
              try {
                await api(`/api/jobs/${job.id}`, { method: "DELETE" });
              } catch {}
            }
          }}
        >
          Clear finished
        </button>
      </header>

      {queueSettingsOpen && (
        <QueueSettingsPanel />
      )}

      <div className="queue-list">
        {!jobsArray.length ? (
          <p className="queue-empty">Nothing queued yet.</p>
        ) : (
          jobsArray.map((job) => <JobRow key={job.id} job={job} />)
        )}
      </div>
    </section>
  );
}

function QueueSettingsPanel() {
  const queue = useStore((s) => s.queue);
  const setQueueSettings = useStore((s) => s.setQueueSettings);
  const config = useStore((s) => s.config);

  const s = queue.settings;

  const pushSettings = async (partial: Partial<typeof s>) => {
    try {
      const updated = await api<typeof s>("/api/queue/settings", {
        method: "POST",
        body: JSON.stringify({ ...s, ...partial }),
      });
      setQueueSettings(updated);
    } catch (err: unknown) {
      toast((err as Error).message);
    }
  };

  return (
    <div className="queue-settings">
      <div className="grid">
        <label className="field check">
          <input
            type="checkbox"
            checked={s.verifyOutput}
            onChange={(e) => pushSettings({ verifyOutput: e.target.checked })}
          />
          <span>Check each finished file opens and plays to the end</span>
        </label>
        <label className="field check">
          <input
            type="checkbox"
            checked={s.autoDeleteSource}
            onChange={(e) => pushSettings({ autoDeleteSource: e.target.checked })}
          />
          <span>Delete the source when the new file is smaller by</span>
        </label>
        <label className="field">
          <span>Shrink threshold (%)</span>
          <input
            type="number"
            min={0}
            max={95}
            step={5}
            value={s.shrinkThreshold}
            onChange={(e) =>
              pushSettings({ shrinkThreshold: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>When the queue empties</span>
          <select
            value={s.postQueue.type}
            onChange={(e) =>
              pushSettings({
                postQueue: { ...s.postQueue, type: e.target.value },
              })
            }
          >
            <option value="none">Do nothing</option>
            <option value="webhook">POST to a URL</option>
            <option value="command">Run a command</option>
          </select>
        </label>
        {s.postQueue.type === "webhook" && (
          <label className="field field-wide">
            <span>URL</span>
            <input
              type="text"
              value={s.postQueue.url}
              onChange={(e) =>
                pushSettings({
                  postQueue: { ...s.postQueue, url: e.target.value },
                })
              }
              placeholder="http://localhost:9000/encodes-finished"
            />
          </label>
        )}
        {s.postQueue.type === "command" && (
          <label className="field field-wide">
            <span>Command</span>
            <input
              type="text"
              value={s.postQueue.command}
              onChange={(e) =>
                pushSettings({
                  postQueue: { ...s.postQueue, command: e.target.value },
                })
              }
              placeholder='notify-send "Encodes finished"'
            />
          </label>
        )}
      </div>
      <p className="note">
        {s.postQueue.type === "command" && !config.allowCommands
          ? "Running a command needs the server started with -allow-commands."
          : s.autoDeleteSource
            ? `Sources are deleted only after the new file passes the check and is at least ${s.shrinkThreshold}% smaller.`
            : ""}
      </p>
    </div>
  );
}
