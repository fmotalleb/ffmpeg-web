import { create } from "zustand";

// The question the dialog puts on screen. The message is rendered as plain
// pre-wrapped text, so callers can build the whole sentence, newlines included.
export interface ConfirmPrompt {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmState {
  prompt: ConfirmPrompt | null;
  ask: (prompt: ConfirmPrompt) => Promise<boolean>;
  settle: (answer: boolean) => void;
}

// Only one question is ever outstanding: a second ask replaces the first,
// which is resolved as "no" rather than left hanging forever.
let resolver: ((answer: boolean) => void) | null = null;

export const useConfirm = create<ConfirmState>((set) => ({
  prompt: null,

  ask: (prompt) =>
    new Promise<boolean>((resolve) => {
      if (resolver) resolver(false);
      resolver = resolve;
      set({ prompt });
    }),

  settle: (answer) => {
    const resolve = resolver;
    resolver = null;
    set({ prompt: null });
    resolve?.(answer);
  },
}));

// The call site's view of the store: it awaits the user's answer without
// knowing anything about where the dialog lives.
export function askConfirm(prompt: ConfirmPrompt): Promise<boolean> {
  return useConfirm.getState().ask(prompt);
}
