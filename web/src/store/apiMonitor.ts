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
  addCall: (path: string, method: string) => string;
  completeCall: (id: string, status: "success" | "error", error?: string) => void;
  clearCompleted: () => void;
}

export const useApiMonitor = create<ApiMonitorState>((set) => ({
  activeCalls: [],
  completedCalls: [],

  addCall: (path, method) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

  completeCall: (id, status, error) => {
    set((state) => {
      const activeCalls = state.activeCalls.filter((c) => c.id !== id);
      const call = state.activeCalls.find((c) => c.id === id);
      if (!call) return { activeCalls };

      const completed: ApiCall = {
        ...call,
        status,
        error,
        duration: Date.now() - call.startTime,
      };

      return {
        activeCalls,
        completedCalls: [completed, ...state.completedCalls].slice(0, 50), // Keep last 50
      };
    });
  },

  clearCompleted: () => {
    set({ completedCalls: [] });
  },
}));
