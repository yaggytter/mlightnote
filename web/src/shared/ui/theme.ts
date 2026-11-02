import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "mlightnote.theme";
const ORDER: ThemeMode[] = ["system", "light", "dark"];

function readStored(): ThemeMode {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system"; // storage blocked (private window, previews)
  }
}

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
}

/**
 * The colour theme: follows the OS by default (like MuseScore 4's "follow
 * system theme"), or is pinned light/dark. The choice is a per-browser
 * convenience, so it lives in localStorage.
 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readStored);
  useEffect(() => {
    apply(mode);
    try {
      if (mode === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // not persisted; the theme still applies for this session
    }
  }, [mode]);
  const cycle = useCallback(() => setMode((m) => ORDER[(ORDER.indexOf(m) + 1) % ORDER.length]), []);
  return { mode, cycle };
}

export const THEME_LABEL: Record<ThemeMode, string> = { system: "システム設定に合わせる", light: "ライト", dark: "ダーク" };
