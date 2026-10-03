// Window manager: one long-lived DOM node per window; focus/move/resize only patch styles
// and classes so nothing is rebuilt under the pointer.
import { need, emit, el, html, raw, cn, icon, store, storageKey, t } from "./core.js";

const factories = new Map();
const views = new Map(); // windowId -> { root, inner, app }
let layer; // container for windows
const state = { windows: {}, focusedId: null, nextZ: 1, nextInstance: {} };
let menuOpen = false;

const D = () => need("desktop");
export const apps = () => need("apps");
export const getApp = (appId) => apps().find((a) => a.id === appId);
export const appIdOf = (windowId) => windowId.replace(/-\d+$/, "");

export function registerApp(appId, factory) {
  factories.set(appId, factory);
}

export function setMenuOpen(open) {
  menuOpen = open;
}

// ---------------------------------------------------------------- geometry
function fitPreset(position, size) {
  const d = D();
  const availableBottom = window.innerHeight - d.dockHeight - d.windowDockGap;
  const availableHeight = Math.max(1, availableBottom - d.menuBarHeight);
  const height = Math.min(size.height, availableHeight);
  const y = Math.min(Math.max(position.y, d.menuBarHeight), availableBottom - height);
  return { position: { x: position.x, y }, size: { width: size.width, height } };
}

function baseWindow(appId, id) {
  const app = getApp(appId);
  return {
    id,
    appId,
    isOpen: false,
    isMinimized: false,
    isMaximized: false,
    position: { ...app.defaultPosition },
    size: { ...app.defaultSize },
    zIndex: 0,
    metadata: {},
  };
}

function freshState() {
  const windows = {};
  apps().forEach((app) => {
    if (!app.multiWindow) windows[app.id] = baseWindow(app.id, app.id);
  });
  return { windows, focusedId: null, nextZ: 1, nextInstance: {} };
}

function defaultState() {
  const s = freshState();
  const layout = D().defaultLayout;
  layout.windows.forEach((cfg, i) => {
    const w = s.windows[cfg.appId];
    const preset = fitPreset(cfg.position, cfg.size ?? w.size);
    Object.assign(w, { isOpen: true, isMaximized: false, zIndex: i + 1, ...preset });
  });
  s.focusedId = layout.focusedAppId;
  s.nextZ = layout.windows.length + 1;
  return s;
}

function normalize() {
  if (state.nextZ <= D().windowZMax) return;
  Object.values(state.windows)
    .sort((a, b) => a.zIndex - b.zIndex)
    .forEach((w, i) => (w.zIndex = i + 1));
  state.nextZ = Object.keys(state.windows).length + 1;
}

// ---------------------------------------------------------------- persistence
function save() {
  store.set("sessionStorage", storageKey("windowLayout"), JSON.stringify(state));
}

export function boot(container, initialAppId) {
  layer = container;
  const saved = store.json("sessionStorage", storageKey("windowLayout"));
  const known = new Set(apps().map((a) => a.id));
  const valid =
    saved &&
    saved.windows &&
    Object.values(saved.windows).every((w) => known.has(w.appId));
  Object.assign(state, valid ? saved : defaultState());
  // Windows of apps added to the registry after the layout was saved.
  apps().forEach((app) => {
    if (!app.multiWindow && !state.windows[app.id]) state.windows[app.id] = baseWindow(app.id, app.id);
  });
  if (initialAppId && known.has(initialAppId) && !getApp(initialAppId).multiWindow) {
    Object.values(state.windows).forEach((w) => {
      if (w.id !== initialAppId && w.isMaximized) w.isMaximized = false;
    });
    const w = state.windows[initialAppId];
    Object.assign(w, { isOpen: true, isMinimized: false, zIndex: state.nextZ++ });
    state.focusedId = initialAppId;
  }
  sync();
}

// ---------------------------------------------------------------- queries
export const getState = () => state;
export const getWindow = (id) => state.windows[id];
export const focusedId = () => state.focusedId;
export const focusedAppId = () => (state.focusedId ? state.windows[state.focusedId]?.appId : null);
export const hasOpenWindows = (appId) =>
  Object.values(state.windows).some((w) => w.appId === appId && w.isOpen);
export const windowsOf = (appId) => Object.values(state.windows).filter((w) => w.appId === appId && w.isOpen);

function topmost(exceptAppId) {
  return (
    Object.values(state.windows)
      .filter((w) => w.isOpen && !w.isMinimized && w.appId !== exceptAppId)
      .sort((a, b) => b.zIndex - a.zIndex)[0]?.id ?? null
  );
}

// ---------------------------------------------------------------- actions
function commit() {
  normalize();
  save();
  sync();
  emit("wm:change", state);
}

export function openWindow(appId, opts = {}) {
  const app = getApp(appId);
  if (app.multiWindow) return openMultiWindow(appId, opts);
  const w = state.windows[appId];
  if (!w.isOpen) {
    const preset = fitPreset(app.defaultPosition, app.defaultSize);
    Object.assign(w, { isOpen: true, isMinimized: false, isMaximized: false, ...preset, metadata: opts.metadata ?? {} });
  }
  w.isMinimized = false;
  w.zIndex = state.nextZ++;
  state.focusedId = w.id;
  commit();
  return w.id;
}

function openMultiWindow(appId, opts) {
  const app = getApp(appId);
  const existing = opts.instanceId
    ? Object.values(state.windows).find((w) => w.appId === appId && w.instanceId === opts.instanceId)
    : null;
  if (existing) {
    focusWindow(existing.id);
    return existing.id;
  }
  const count = windowsOf(appId).length;
  const n = state.nextInstance[appId] ?? 0;
  const id = `${appId}-${n}`;
  const preset = fitPreset(
    opts.position ?? {
      x: app.defaultPosition.x + count * app.cascadeOffset,
      y: app.defaultPosition.y + count * app.cascadeOffset,
    },
    opts.size ?? app.defaultSize,
  );
  state.windows[id] = {
    ...baseWindow(appId, id),
    ...preset,
    isOpen: true,
    instanceId: opts.instanceId ?? id,
    zIndex: state.nextZ++,
    metadata: opts.metadata ?? {},
  };
  state.nextInstance[appId] = n + 1;
  state.focusedId = id;
  commit();
  return id;
}

export function closeWindow(id) {
  const w = state.windows[id];
  if (!w) return;
  const app = getApp(w.appId);
  if (app.multiWindow) delete state.windows[id];
  else Object.assign(w, { isOpen: false, isMaximized: false, isMinimized: false });
  emit("app:closed", { windowId: id, appId: w.appId });
  if (state.focusedId === id) state.focusedId = topmost(null);
  commit();
}

export function closeApp(appId) {
  Object.values(state.windows)
    .filter((w) => w.appId === appId && w.isOpen)
    .forEach((w) => closeWindow(w.id));
}

export function focusWindow(id) {
  const w = state.windows[id];
  if (!w || !w.isOpen) return;
  if (state.focusedId === id && w.zIndex === state.nextZ - 1) return;
  w.zIndex = state.nextZ++;
  state.focusedId = id;
  commit();
}

export function minimizeWindow(id) {
  const w = state.windows[id];
  if (!w || !w.isOpen) return;
  w.isMinimized = true;
  state.focusedId = topmost(w.appId);
  commit();
}

export function unminimizeWindow(id) {
  const w = state.windows[id];
  if (!w) return;
  Object.assign(w, { isMinimized: false, zIndex: state.nextZ++ });
  state.focusedId = id;
  commit();
}

export function toggleMaximize(id) {
  const w = state.windows[id];
  if (!w) return;
  w.isMaximized = !w.isMaximized;
  w.isMinimized = false;
  w.zIndex = state.nextZ++;
  state.focusedId = id;
  commit();
}

export function moveWindow(id, position) {
  state.windows[id].position = position;
  commit();
}

export function resizeWindow(id, size, position) {
  const w = state.windows[id];
  w.size = size;
  if (position) w.position = position;
  commit();
}

export function bringAppToFront(appId) {
  const list = windowsOf(appId).sort((a, b) => a.zIndex - b.zIndex);
  list.forEach((w) => Object.assign(w, { zIndex: state.nextZ++, isMinimized: false }));
  if (list.length) state.focusedId = list[list.length - 1].id;
  commit();
}

export function setMetadata(id, metadata) {
  const w = state.windows[id];
  if (!w) return;
  w.metadata = { ...w.metadata, ...metadata };
  save();
}

// ---------------------------------------------------------------- window chrome
export function windowControls(windowId, extraClass) {
  const w = state.windows[windowId];
  const max = w && w.isMaximized;
  const btn = (action, color, label, glyph) => html`
    <button type="button" data-wc="${action}" aria-label="${label}"
      class="relative w-3 h-3 rounded-full flex items-center justify-center cursor-pointer ${color}">
      <span class="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 desktop:can-hover:group-hover:opacity-100 text-black/50">${icon(glyph, "w-2.5 h-2.5")}</span>
    </button>`;
  return html`<div class="${cn("window-controls group flex items-center gap-1.5", extraClass)}">
    ${btn("close", "bg-red-500", t("window.close"), "wcClose")}
    ${btn("minimize", "bg-yellow-500", t("window.minimize"), "wcMinimize")}
    ${btn("maximize", "bg-green-500", max ? t("window.restore") : t("window.maximize"), max ? "wcRestore" : "wcZoom")}
  </div>`;
}

const RESIZE_HANDLES = [
  ["nw", "cursor-nw-resize", "corner", { top: -3, left: -3 }],
  ["ne", "cursor-ne-resize", "corner", { top: -3, right: -3 }],
  ["sw", "cursor-sw-resize", "corner", { bottom: -3, left: -3 }],
  ["se", "cursor-se-resize", "corner", { bottom: -3, right: -3 }],
  ["n", "cursor-n-resize", "edgeX", { top: -3 }],
  ["s", "cursor-s-resize", "edgeX", { bottom: -3 }],
  ["e", "cursor-e-resize", "edgeY", { right: -3 }],
  ["w", "cursor-w-resize", "edgeY", { left: -3 }],
];

function handleStyle(kind, pos) {
  const { resizeCorner: c, resizeEdge: e } = D();
  const parts = Object.entries(pos).map(([k, v]) => `${k}:${v}px`);
  if (kind === "corner") parts.push(`width:${c}px`, `height:${c}px`, "z-index:20");
  if (kind === "edgeX") parts.push(`left:${c}px`, `right:${c}px`, `height:${e}px`, "z-index:10");
  if (kind === "edgeY") parts.push(`top:${c}px`, `bottom:${c}px`, `width:${e}px`, "z-index:10");
  return parts.join(";");
}

function createView(w) {
  const root = el(html`<div class="fixed" data-window-id="${w.id}">
    <div class="absolute inset-0 overflow-hidden shadow-2xl flex flex-col bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-xl" data-window-inner>
      <div class="flex-1 min-h-0" data-window-content></div>
    </div>
    ${RESIZE_HANDLES.map(
      ([dir, cls, kind, pos]) =>
        raw(`<div class="absolute ${cls}" data-window-resize-handle="${dir}" style="${handleStyle(kind, pos)}"></div>`),
    )}
  </div>`);
  const inner = root.querySelector("[data-window-inner]");
  const content = root.querySelector("[data-window-content]");
  const factory = factories.get(w.appId);
  const ctx = makeContext(w.id);
  const app = factory(ctx);
  content.appendChild(app.el);
  wireWindow(root, w.id);
  layer.appendChild(root);
  const view = { root, inner, app, ctx };
  views.set(w.id, view);
  return view;
}

function makeContext(windowId) {
  return {
    windowId,
    get window() {
      return state.windows[windowId];
    },
    isFocused: () => state.focusedId === windowId,
    close: () => closeWindow(windowId),
    minimize: () => minimizeWindow(windowId),
    toggleMaximize: () => toggleMaximize(windowId),
    startDrag: (e) => startDrag(e, windowId),
    controls: (cls) => windowControls(windowId, cls),
    setMetadata: (m) => setMetadata(windowId, m),
  };
}

function sync() {
  const d = D();
  for (const w of Object.values(state.windows)) {
    let view = views.get(w.id);
    if (!w.isOpen) {
      if (view) {
        view.app.destroy?.();
        view.root.remove();
        views.delete(w.id);
      }
      continue;
    }
    if (!view) view = createView(w);
    const focused = state.focusedId === w.id;
    const hidden = w.isMinimized;
    const s = view.root.style;
    view.root.hidden = hidden;
    if (w.isMaximized) {
      s.transform = "";
      Object.assign(s, { top: "0px", left: "0px", right: "0px", bottom: "0px", width: "auto", height: "auto" });
      s.zIndex = String(d.maximizedZIndex);
    } else {
      Object.assign(s, { top: "", left: "", right: "", bottom: "" });
      s.transform = `translate(${w.position.x}px, ${w.position.y}px)`;
      s.width = `${w.size.width}px`;
      s.height = `${w.size.height}px`;
      s.zIndex = String(w.zIndex);
    }
    view.root.classList.toggle("opacity-95", !focused && !w.isMaximized);
    view.inner.classList.toggle("rounded-xl", !w.isMaximized);
    view.inner.classList.toggle("rounded-none", w.isMaximized);
    view.inner.classList.toggle("[&_*]:!cursor-default", !focused);
    view.root.querySelectorAll("[data-window-resize-handle]").forEach((h) => (h.hidden = w.isMaximized));
    view.root.querySelectorAll("[data-wc='maximize']").forEach((b) => {
      b.setAttribute("aria-label", w.isMaximized ? t("window.restore") : t("window.maximize"));
      b.querySelector("span").innerHTML = need(`icons.${w.isMaximized ? "wcRestore" : "wcZoom"}`).replace(
        "<svg",
        '<svg class="w-2.5 h-2.5"',
      );
    });
    view.app.update?.({ focused, maximized: w.isMaximized });
  }
}

// ---------------------------------------------------------------- interaction
function wireWindow(root, id) {
  let wasFocused = true;
  let suppressDblUntil = 0;
  let restoreFrame = null;

  root.addEventListener(
    "mousedown",
    (e) => {
      const w = state.windows[id];
      if (!w || w.isMinimized) return;
      if (menuOpen) {
        e.stopPropagation();
        e.preventDefault();
        emit("menu:dismiss");
        return;
      }
      wasFocused = state.focusedId === id;
      focusWindow(id);
      if (!wasFocused) {
        const control = e.target.closest(".window-controls");
        const handle = e.target.closest("[data-window-resize-handle]");
        if (!control && !handle) {
          e.stopPropagation();
          e.preventDefault();
          suppressDblUntil = performance.now() + 500;
        }
      }
    },
    true,
  );

  root.addEventListener(
    "click",
    (e) => {
      if (menuOpen) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (!wasFocused && !e.target.closest(".window-controls")) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-wc]");
    if (!b || !root.contains(b)) return;
    const action = b.dataset.wc;
    if (action === "close") closeWindow(id);
    if (action === "minimize") minimizeWindow(id);
    if (action === "maximize") toggleMaximize(id);
  });

  root.addEventListener(
    "dblclick",
    (e) => {
      const isControl = e.target.closest(".window-controls");
      if (!isControl && performance.now() < suppressDblUntil) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      const titleBar = e.target.closest("[data-window-drag-handle='true']");
      const interactive = e.target.closest(
        "a, button, input, select, textarea, [contenteditable='true'], [role='button'], [role='menuitem']",
      );
      if (!titleBar || interactive) return;
      e.stopPropagation();
      e.preventDefault();
      const w = state.windows[id];
      if (restoreFrame) {
        const f = restoreFrame;
        restoreFrame = null;
        resizeWindow(id, f.size, f.position);
        return;
      }
      if (w.isMaximized) {
        toggleMaximize(id);
        return;
      }
      restoreFrame = { position: { ...w.position }, size: { ...w.size } };
      const d = D();
      resizeWindow(
        id,
        {
          width: window.innerWidth,
          height: Math.max(getApp(w.appId).minSize.height, window.innerHeight - d.menuBarHeight - d.dockHeight),
        },
        { x: 0, y: d.menuBarHeight },
      );
    },
    true,
  );

  root.querySelectorAll("[data-window-resize-handle]").forEach((h) =>
    h.addEventListener("mousedown", (e) => startResize(e, id, h.dataset.windowResizeHandle)),
  );
}

function track(onMove, onEnd) {
  let raf = null;
  let last = null;
  const move = (e) => {
    last = e;
    if (raf === null) {
      raf = requestAnimationFrame(() => {
        raf = null;
        if (last.buttons === 0) return end();
        onMove(last);
      });
    }
  };
  const end = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", end);
    window.removeEventListener("blur", end);
    onEnd();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  window.addEventListener("blur", end);
}

export function startDrag(e, id) {
  if (e.target.closest(".window-controls")) return;
  const w = state.windows[id];
  if (!w || w.isMaximized || e.button !== 0) return;
  e.preventDefault();
  focusWindow(id);
  const view = views.get(id);
  const offset = { x: e.clientX - w.position.x, y: e.clientY - w.position.y };
  let pos = { ...w.position };
  let moved = false;
  track(
    (ev) => {
      const d = D();
      const x = Math.max(-(w.size.width - 100), Math.min(window.innerWidth - 100, ev.clientX - offset.x));
      const y = Math.max(d.menuBarHeight, Math.min(window.innerHeight - d.dockHeight - 50, ev.clientY - offset.y));
      if (x !== pos.x || y !== pos.y) moved = true;
      pos = { x, y };
      view.root.style.transform = `translate(${x}px, ${y}px)`;
    },
    () => moved && moveWindow(id, pos),
  );
}

function startResize(e, id, dir) {
  const w = state.windows[id];
  if (w.isMaximized) return;
  e.preventDefault();
  e.stopPropagation();
  focusWindow(id);
  const view = views.get(id);
  const min = getApp(w.appId).minSize;
  const start = { x: e.clientX, y: e.clientY, ...w.size, posX: w.position.x, posY: w.position.y };
  let size = { ...w.size };
  let pos = { ...w.position };
  let changed = false;
  track(
    (ev) => {
      const d = D();
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      let width = start.width;
      let height = start.height;
      let x = start.posX;
      let y = start.posY;
      if (dir.includes("e")) width = Math.max(min.width, Math.min(window.innerWidth - start.posX, start.width + dx));
      else if (dir.includes("w")) {
        width = Math.max(min.width, Math.min(start.width + start.posX, start.width - dx));
        x = start.posX + (start.width - width);
      }
      if (dir.includes("s"))
        height = Math.max(min.height, Math.min(window.innerHeight - d.dockHeight - start.posY, start.height + dy));
      else if (dir.includes("n")) {
        height = Math.max(min.height, Math.min(start.height + start.posY - d.menuBarHeight, start.height - dy));
        y = start.posY + (start.height - height);
      }
      changed = true;
      size = { width, height };
      pos = { x, y };
      view.root.style.transform = `translate(${x}px, ${y}px)`;
      view.root.style.width = `${width}px`;
      view.root.style.height = `${height}px`;
    },
    () => changed && resizeWindow(id, size, pos),
  );
}
