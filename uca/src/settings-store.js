// System settings (appearance, clock, wallpaper …). Initial values come from
// componentProps.settings.defaults; the viewer's changes persist in localStorage.
import { need, emit, store, storageKey } from "./core.js";

let current = null;

export function settings() {
  if (!current) {
    const saved = store.json("localStorage", storageKey("systemSettings"));
    current = { ...need("settings.defaults"), ...(saved && typeof saved === "object" ? saved : {}) };
  }
  return current;
}

export function updateSettings(patch) {
  current = { ...settings(), ...patch };
  store.set("localStorage", storageKey("systemSettings"), JSON.stringify(current));
  applyAppearance();
  emit("settings:change", current);
}

export function applyAppearance() {
  const mode = settings().appearance;
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function watchSystemAppearance() {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyAppearance);
}
