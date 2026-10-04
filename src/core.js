// UCA 3.0 core: componentProps access (zero-fallback), event bus, theme, small DOM helpers.
/* global componentProps */

export class MissingProp extends Error {
  constructor(path) {
    super(`componentProps.${path} is not configured`);
    this.path = path;
  }
}

// Reads a required value from componentProps. A missing value throws so it surfaces
// as a visible, specific error instead of a silent default.
export function need(path) {
  let value = componentProps;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || !(key in value)) {
      throw new MissingProp(path);
    }
    value = value[key];
  }
  if (value === undefined || value === null) throw new MissingProp(path);
  return value;
}

// Optional values exist in props as explicit nulls/empties; `has` lets callers branch on presence.
export function has(path) {
  try {
    need(path);
    return true;
  } catch (e) {
    if (e instanceof MissingProp) return false;
    throw e;
  }
}

// String table lookup with {placeholders}.
export function t(key, vars) {
  const table = need("strings");
  if (!(key in table)) throw new MissingProp(`strings["${key}"]`);
  let s = table[key];
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

// ---------------------------------------------------------------- bus
const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}
export function emit(event, detail) {
  const set = listeners.get(event);
  if (set) [...set].forEach((fn) => fn(detail));
}

// ---------------------------------------------------------------- DOM helpers
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

// Tagged template: interpolated values are escaped unless they are themselves html``/raw()
// results, so templates nest safely. The result converts to a string wherever one is needed.
class SafeHtml {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new SafeHtml(out);
}
export const raw = (s) => new SafeHtml(String(s));
function render(v) {
  if (v === null || v === undefined || v === false) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  if (v instanceof SafeHtml) return v.text;
  return esc(v);
}

export const cn = (...parts) => parts.filter(Boolean).join(" ");

export function el(markup) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(markup).trim();
  return tpl.content.firstElementChild;
}

// Icons are SVG markup supplied in componentProps.icons.
export function icon(name, cls) {
  const svg = need(`icons.${name}`);
  return raw(cls ? svg.replace("<svg", `<svg class="${esc(cls)}"`) : svg);
}

export function asset(name) {
  return need(`assets.${name}`);
}

// ---------------------------------------------------------------- storage
// Storage can be blocked (private mode, sandboxed iframes); failures are non-fatal by design.
export const store = {
  get(kind, key) {
    try {
      return window[kind].getItem(key);
    } catch {
      return null;
    }
  },
  set(kind, key, value) {
    try {
      window[kind].setItem(key, value);
    } catch {
      /* storage unavailable: keep in-memory state */
    }
  },
  remove(kind, key) {
    try {
      window[kind].removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
  json(kind, key) {
    const v = store.get(kind, key);
    if (v === null) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  },
};

export const storageKey = (name) => need(`storage.${name}`);

// ---------------------------------------------------------------- theme
export function applyCSSProps() {
  const theme = need("theme");
  const root = document.documentElement;
  for (const [k, v] of Object.entries(need("theme.palette"))) root.style.setProperty(`--color-${k}`, v);
  for (const [k, v] of Object.entries(need("theme.literals"))) root.style.setProperty(`--lit-${k}`, v);
  for (const [k, v] of Object.entries(need("theme.fonts"))) root.style.setProperty(`--font-${k}`, v);

  // Light/dark semantic tokens become one generated rule set.
  const modes = need("theme.modes");
  const decls = (map) => Object.entries(map).map(([k, v]) => `--${k}:${v};`).join("");
  let css = `:root{${decls(modes.light)}}.dark{${decls(modes.dark)}}`;
  let style = document.getElementById("pc-theme");
  if (!style) {
    style = document.createElement("style");
    style.id = "pc-theme";
    document.head.appendChild(style);
  }
  style.textContent = css;
  return theme;
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
