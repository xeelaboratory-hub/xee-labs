import { create } from "zustand";

export type ThemeMode = "dark" | "light";
export type ThemeAccent = "teal" | "blue" | "violet" | "amber";

interface ThemeState {
  mode: ThemeMode;
  accent: ThemeAccent;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setAccent: (accent: ThemeAccent) => void;
}

function applyTheme(mode: ThemeMode, accent: ThemeAccent) {
  document.documentElement.classList.toggle("light", mode === "light");
  if (accent === "teal") {
    delete document.documentElement.dataset.accent;
  } else {
    document.documentElement.dataset.accent = accent;
  }
}

const initialMode: ThemeMode = localStorage.getItem("theme_mode") === "light" ? "light" : "dark";
const storedAccent = localStorage.getItem("theme_accent");
const initialAccent: ThemeAccent =
  storedAccent === "blue" || storedAccent === "violet" || storedAccent === "amber" ? storedAccent : "teal";

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  accent: initialAccent,

  setMode: (mode) => {
    localStorage.setItem("theme_mode", mode);
    applyTheme(mode, get().accent);
    set({ mode });
  },

  toggleMode: () => {
    const next: ThemeMode = get().mode === "dark" ? "light" : "dark";
    get().setMode(next);
  },

  setAccent: (accent) => {
    localStorage.setItem("theme_accent", accent);
    applyTheme(get().mode, accent);
    set({ accent });
  },
}));

// index.html already applies the persisted classes before React mounts (avoids
// a flash of the wrong theme) — this call re-syncs in case localStorage was
// unavailable at that point (e.g. blocked in a privacy mode).
applyTheme(initialMode, initialAccent);
