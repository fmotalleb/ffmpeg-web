import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { api } from "../../api";

export function ProbeViewer() {
  const probeOpen = useStore((s) => s.probeOpen);
  const probeTitle = useStore((s) => s.probeTitle);
  const probeUrl = useStore((s) => s.probeUrl);
  const setProbe = useStore((s) => s.setProbe);

  const [path, setPath] = useState("");
  const [body, setBody] = useState("Reading\u2026");

  useEffect(() => {
    if (probeOpen && probeUrl) {
      setBody("Reading\u2026");
      setPath("");
      api(probeUrl)
        .then((data: unknown) => {
          const d = data as { format?: { filename?: string } };
          setPath(d.format?.filename || "");
          setBody(highlightJSON(JSON.stringify(data, null, 2)));
        })
        .catch((err: unknown) => {
          setBody((err as Error).message);
        });
    }
  }, [probeOpen, probeUrl]);

  if (!probeOpen) return null;

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) setProbe(false);
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="probe-title">
        <header className="modal-head">
          <h2 id="probe-title">{probeTitle}</h2>
          <button className="btn btn-quiet" onClick={() => setProbe(false)}>
            Close
          </button>
        </header>
        {path && <p className="browser-path">{path}</p>}
        <pre className="probe-body" dangerouslySetInnerHTML={{ __html: body }} />
      </div>
    </div>
  );
}

function highlightJSON(text: string): string {
  const escaped = text.replace(/[&<>]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c),
  );
  return escaped.replace(
    /("(\\.|[^"\\])*")(\s*:)?|\b(-?\d+(\.\d+)?)\b/g,
    (_match, str, _b, colon, num) => {
      if (str) return `<span class="${colon ? "k" : "s"}">${str}</span>${colon || ""}`;
      return `<span class="n">${num}</span>`;
    },
  );
}
