import { create } from "zustand";

export interface ApiCall {
  id: string;
  path: string;
  method: string;
  startTime: number;
  status: "running" | "success" | "error";
  error?: string;
  duration?: number;
}

interface ApiMonitorState {
  activeCalls: ApiCall[];
  completedCalls: ApiCall[];
  // The panel is a heads-up display, not a workspace: it starts minimized so
  // it never eats the screen, and the badges in the header carry the summary.
  collapsed: boolean;
  addCall: (path: string, method: string) => string;
  completeCall: (id: string, status: "success" | "error", error?: string) => void;
  setCollapsed: (c: boolean) => void;
  clearAll: () => void;
}

// Keep enough history for the badges to be meaningful without letting the
// list grow without bound during a long session.
const MAX_COMPLETED = 100;

let callSeq = 0;

export const useApiMonitor = create<ApiMonitorState>((set) => ({
  activeCalls: [],
  completedCalls: [],
  collapsed: true,

  addCall: (path, method) => {
    const id = `api-${++callSeq}-${Date.now()}`;
    const call: ApiCall = {
      id,
      path,
      method,
      startTime: Date.now(),
      status: "running",
    };
    // New calls go to the top (most recent first)
    set((state) => ({
      activeCalls: [call, ...state.activeCalls],
    }));
    return id;
  },

  completeCall: (id, status, error) =>
    set((state) => {
      const call = state.activeCalls.find((c) => c.id === id);
      // Already completed, or cleared while it was in flight: nothing to do.
      if (!call) return {};

      const completed: ApiCall = {
        ...call,
        status,
        error,
        duration: Date.now() - call.startTime,
      };

      return {
        activeCalls: state.activeCalls.filter((c) => c.id !== id),
        completedCalls: [completed, ...state.completedCalls].slice(0, MAX_COMPLETED),
      };
    }),

  setCollapsed: (c) => set({ collapsed: c }),

  clearAll: () => set({ activeCalls: [], completedCalls: [] }),
}));
