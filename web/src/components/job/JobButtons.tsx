import { api, toast } from "../../api";

export function ActionButton({
  label,
  onClick,
  danger,
  accent,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      className={`btn btn-small btn-quiet${danger ? " btn-danger" : ""}${accent ? " btn-accent" : ""}`}
      onClick={async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        // Disabling guards against a double click while the call is in
        // flight, but it must always be undone: Details and Preview only open
        // something, and the row is not re-rendered afterwards, so a button
        // left disabled would never come back.
        btn.disabled = true;
        try {
          await onClick();
        } catch (err: unknown) {
          toast((err as Error).message);
        } finally {
          btn.disabled = false;
        }
      }}
    >
      {label}
    </button>
  );
}

export function MoveButton({
  glyph,
  id,
  delta,
}: {
  glyph: string;
  id: string;
  delta: number;
}) {
  return (
    <button
      className="btn btn-small btn-quiet move-btn"
      title={delta === 0 ? "Move to the top" : delta < 0 ? "Move up" : "Move down"}
      onClick={async () => {
        try {
          await api(`/api/jobs/${id}/move`, {
            method: "POST",
            body: JSON.stringify({ delta }),
          });
        } catch (err: unknown) {
          toast((err as Error).message);
        }
      }}
    >
      {glyph}
    </button>
  );
}
