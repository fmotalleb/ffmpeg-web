import { useEffect } from "react";
import { useConfirm } from "../../store/confirm";

// The replace-or-cancel question. It is a real dialog rather than
// window.confirm() because the decision is part of the app's flow: it can be
// styled, it can explain the choice, and no browser setting can swallow it.
export function ConfirmDialog() {
  const prompt = useConfirm((s) => s.prompt);
  const settle = useConfirm((s) => s.settle);

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompt, settle]);

  if (!prompt) return null;

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div
        className="modal-card confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <header className="modal-head">
          <h2 id="confirm-title">{prompt.title}</h2>
        </header>
        <div className="modal-body">
          <p id="confirm-body" className="confirm-text">
            {prompt.message}
          </p>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={() => settle(false)}>
            {prompt.cancelLabel ?? "Cancel"}
          </button>
          <button className="btn btn-primary" onClick={() => settle(true)}>
            {prompt.confirmLabel ?? "Confirm"}
          </button>
        </footer>
      </div>
    </div>
  );
}
