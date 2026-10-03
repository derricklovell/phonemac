// System settings (appearance, clock, wallpaper …). Initial values come from
// componentProps.settings.defaults; the viewer's changes persist in localStorage.
import { need, emit, store, storageKey } from "./core.js";

let current = null;
let applied = null; // { appearance, scheme } last put on the page

export const APPEARANCES = ["light", "dark", "system"];

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

// The single entry point for light / dark / system. Everything that draws (Tailwind `dark:`
// classes, native controls via color-scheme, record frames via shell:appearance) follows it.
export function setAppearance(appearance) {
  if (!APPEARANCES.includes(appearance) || settings().appearance === appearance) return;
  updateSettings({ appearance });
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

// "light" | "dark" — what "system" currently resolves to included.
export function appearanceScheme() {
  const mode = settings().appearance;
  return mode === "dark" || (mode === "system" && systemDark()) ? "dark" : "light";
}

export function applyAppearance() {
  const appearance = settings().appearance;
  const scheme = appearanceScheme();
  if (applied && applied.appearance === appearance && applied.scheme === scheme) return;
  const flip = applied !== null && applied.scheme !== scheme;
  if (flip) suspendTransitions();
  document.documentElement.classList.toggle("dark", scheme === "dark");
  document.documentElement.style.colorScheme = scheme;
  applied = { appearance, scheme };
  emit("appearance:change", applied);
}

// Same as the original's next-themes `disableTransitionOnChange`: every colour swaps in one frame
// instead of each element easing at its own speed. The theme switch's own thumb keeps its slide.
function suspendTransitions() {
  const style = document.createElement("style");
  style.textContent = "*:not([data-theme-thumb]),*::before,*::after{transition:none!important}";
  document.head.appendChild(style);
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
}

export function watchSystemAppearance() {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyAppearance);
  // Another tab changed the settings: take them over so every open copy shows the same theme.
  window.addEventListener("storage", (e) => {
    if (e.key !== storageKey("systemSettings")) return;
    current = null;
    applyAppearance();
    emit("settings:change", settings());
  });
}
