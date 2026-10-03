// Dock: keyed icons (never rebuilt under the pointer), magnification, tooltips,
// per-app context menu, resize handle and Trash.
import { need, t, emit, on, el, html, raw, cn, asset, store, storageKey } from "./core.js";
import * as wm from "./wm.js";

const items = new Map(); // id -> { root, frame, dot, badge }
const badges = {};
let wrap, rail, handleWrap, trashBtn, tooltip, menuEl;
let hovered = null;
let scale = 1;
let magnification = true;
let resizing = false;
let scales = {};
let pendingX = null;
let frameReq = null;
let keep = {};
const initial = new Set();
let animState = {};

const C = () => need("dock");

export function setBadge(appId, count) {
  badges[appId] = count;
  if (rail) reconcile();
}

function metrics() {
  const c = C();
  const s = Math.round(Math.min(c.maxScale, Math.max(c.minScale, scale)) * 1000) / 1000;
  const r = (base, min) => Math.max(min, Math.round(base * s));
  return {
    icon: r(c.iconSize, 30),
    gap: r(c.gap, 2),
    padX: r(c.paddingX, 8),
    padY: r(c.paddingY, 4),
    dividerHeight: r(c.dividerHeight, 30),
    dividerMarginX: r(c.dividerMarginX, 2),
    dot: r(c.dotSize, 2),
    badgeHeight: r(c.badgeHeight, 14),
    badgeMinWidth: r(c.badgeMinWidth, 14),
    badgePaddingX: r(c.badgePaddingX, 2),
    badgeFontSize: r(c.badgeFontSize, 9),
    handleHitbox: r(c.handleHitboxWidth, 10),
    handleLine: r(c.handleLineWidth, 1),
  };
}

const dockApps = () =>
  wm
    .apps()
    .map((app, i) => ({ app, i }))
    .sort((a, b) => {
      const l = a.app.dockOrder;
      const r = b.app.dockOrder;
      if (l !== null && r !== null) return l - r;
      if (l !== null) return -1;
      if (r !== null) return 1;
      return a.i - b.i;
    })
    .map(({ app }) => app);

const keptInDock = (app) => (app.id in keep ? keep[app.id] : app.showOnDockByDefault);

export function mount(container) {
  keep = store.json("localStorage", storageKey("dockKeep")) ?? {};
  scale = Number(store.get("sessionStorage", storageKey("dockScale")) ?? 1) || 1;
  magnification = store.get("sessionStorage", storageKey("dockMagnification")) !== "false";

  wrap = el(`<div class="fixed bottom-3 left-1/2 -translate-x-1/2 z-[60]" data-dock></div>`);
  rail = el(
    `<div class="flex items-end bg-white/30 dark:bg-black/30 backdrop-blur-2xl rounded-2xl border border-white/10 dark:border-white/10 shadow-lg w-max transition-all duration-300"></div>`,
  );
  wrap.appendChild(rail);
  container.appendChild(wrap);

  handleWrap = el(html`<div data-dock-static="true" class="relative self-center">
    <button type="button" aria-label="${t("dock.resize")}" aria-haspopup="menu" aria-expanded="false" title="${t("dock.resize")}"
      class="relative rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70" data-dock-handle>
      <span aria-hidden="true" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/20 dark:bg-white/10 rounded-full"></span>
    </button>
  </div>`);
  trashBtn = makeItem("trash", t("dock.trash"), asset("trash"), 1);

  dockApps()
    .filter((a) => keptInDock(a) || wm.hasOpenWindows(a.id))
    .forEach((a) => initial.add(a.id));

  wireRail();
  wireHandle();
  reconcile();
  on("wm:change", reconcile);
  on("menu:dismiss", closeMenu);
  setInterval(refreshCalendarIcon, 60000);
}

function makeItem(id, name, src, iconScale) {
  const root = el(html`<button type="button" aria-label="${name}" aria-haspopup="menu" aria-expanded="false" data-dock-item="${id}"
    class="group relative flex flex-col items-center outline-none transition-[width,transform] duration-100 ease-out flex-shrink-0 active:scale-95">
    <div class="relative flex items-center justify-center transition-transform duration-100 ease-out" data-frame style="transform-origin: center bottom;">
      ${
        id === "calendar"
          ? raw('<div data-calendar-icon class="relative overflow-hidden shadow-md bg-white flex flex-col items-center justify-center"><span class="text-calendar-red font-medium leading-none"></span><span class="text-calendar-ink font-normal leading-none"></span></div>')
          : html`<img alt="${name}" draggable="false" decoding="async" src="${src}" class="object-contain [filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.35))] pointer-events-none" style="transform: scale(${iconScale})">`
      }
    </div>
    <div class="rounded-full mt-1 transition-opacity" data-dot></div>
  </button>`);
  return root;
}

function refreshCalendarIcon() {
  const node = items.get("calendar")?.root.querySelector("[data-calendar-icon]");
  if (!node) return;
  const m = metrics();
  const size = Math.round(m.icon * C().calendarIconRatio);
  const now = new Date();
  const [day, date] = node.children;
  day.textContent = now.toLocaleDateString(need("formats.locale"), { weekday: "short" });
  date.textContent = String(now.getDate());
  Object.assign(node.style, {
    width: `${size}px`,
    height: `${size}px`,
    paddingTop: `${size * 0.04}px`,
    borderRadius: `${Math.round(size * 0.21)}px`,
  });
  day.style.fontSize = `${size * 0.22}px`;
  date.style.fontSize = `${size * 0.56}px`;
  date.style.marginTop = `${-size * 0.04}px`;
}

function reconcile() {
  const visible = dockApps().filter((a) => keptInDock(a) || wm.hasOpenWindows(a.id));
  const ids = new Set(visible.map((a) => a.id));
  const m = metrics();

  // Exiting apps animate out before removal.
  for (const [id, entry] of items) {
    if (id !== "trash" && !ids.has(id) && animState[id] !== "exiting") {
      animState[id] = "exiting";
      entry.root.classList.add("animate-dock-exit");
      setTimeout(() => {
        if (animState[id] !== "exiting") return;
        entry.root.remove();
        items.delete(id);
        delete animState[id];
        initial.delete(id);
      }, C().exitMs);
    }
  }

  let prev = null;
  for (const app of visible) {
    let entry = items.get(app.id);
    if (!entry || animState[app.id] === "exiting") {
      if (entry) entry.root.remove();
      const root = makeItem(app.id, app.name, asset(app.icon), app.dockIconScale);
      entry = { root, frame: root.querySelector("[data-frame]"), dot: root.querySelector("[data-dot]") };
      items.set(app.id, entry);
      if (!initial.has(app.id)) {
        animState[app.id] = "entering";
        root.classList.add("animate-dock-enter");
        setTimeout(() => {
          if (animState[app.id] === "entering") {
            animState[app.id] = "stable";
            root.classList.remove("animate-dock-enter");
          }
        }, C().enterMs);
      } else animState[app.id] = "stable";
    }
    const anchor = prev ? prev.nextSibling : rail.firstChild;
    if (entry.root !== anchor) rail.insertBefore(entry.root, anchor);
    prev = entry.root;

    const open = wm.hasOpenWindows(app.id) || app.alwaysShowsOpenIndicator;
    entry.dot.className = cn(
      "rounded-full mt-1 transition-opacity",
      open ? "bg-black/60 dark:bg-white/60 opacity-100" : "opacity-0",
    );
    const count = badges[app.id] ?? 0;
    let badge = entry.frame.querySelector("[data-badge]");
    if (count > 0) {
      if (!badge) {
        badge = el(
          `<div data-badge class="absolute -top-1 -right-1 rounded-full bg-red-500 text-white font-semibold leading-none flex items-center justify-center shadow-[0_1px_3px_rgba(0,0,0,0.45)]"></div>`,
        );
        entry.frame.appendChild(badge);
      }
      badge.textContent = count > 99 ? "99+" : String(count);
    } else if (badge) badge.remove();
  }
  // Exiting items stay where they are until removed; handle + trash always last.
  rail.appendChild(handleWrap);
  rail.appendChild(trashBtn);
  if (!items.has("trash")) items.set("trash", { root: trashBtn, frame: trashBtn.querySelector("[data-frame]"), dot: trashBtn.querySelector("[data-dot]") });
  trashBtn.querySelector("[data-dot]").className = "rounded-full mt-1 opacity-0";
  layout(m);
  refreshCalendarIcon();
}

function layout(m = metrics()) {
  rail.style.gap = `${m.gap}px`;
  rail.style.padding = `${m.padY}px ${m.padX}px`;
  rail.classList.toggle("transition-none", resizing);
  rail.classList.toggle("transition-all", !resizing);
  for (const [id, entry] of items) {
    const s = magnification && !resizing && animState[id] !== "entering" ? (scales[id] ?? 1) : 1;
    entry.root.style.width = `${m.icon * s}px`;
    Object.assign(entry.frame.style, {
      width: `${m.icon}px`,
      height: `${m.icon}px`,
      transform: `scale(${s})`,
    });
    const img = entry.frame.querySelector("img");
    if (img) {
      img.width = m.icon;
      img.height = m.icon;
    }
    entry.dot.style.width = `${m.dot}px`;
    entry.dot.style.height = `${m.dot}px`;
    const badge = entry.frame.querySelector("[data-badge]");
    if (badge)
      Object.assign(badge.style, {
        minWidth: `${m.badgeMinWidth}px`,
        height: `${m.badgeHeight}px`,
        paddingLeft: `${m.badgePaddingX}px`,
        paddingRight: `${m.badgePaddingX}px`,
        fontSize: `${m.badgeFontSize}px`,
      });
  }
  const handle = handleWrap.querySelector("[data-dock-handle]");
  Object.assign(handle.style, {
    width: `${m.handleHitbox}px`,
    height: `${m.dividerHeight + 8}px`,
    marginLeft: `${m.dividerMarginX}px`,
    marginRight: `${m.dividerMarginX}px`,
    cursor: "ns-resize",
    touchAction: "none",
  });
  const line = handle.querySelector("span");
  line.style.width = `${m.handleLine}px`;
  line.style.height = `${m.dividerHeight}px`;
  line.classList.toggle("bg-black/35", resizing);
  line.classList.toggle("dark:bg-white/30", resizing);
  showTooltip();
}

function showTooltip() {
  tooltip?.remove();
  tooltip = null;
  if (!hovered || resizing || animState[hovered] === "entering") return;
  const entry = items.get(hovered);
  if (!entry) return;
  const m = metrics();
  const s = magnification ? (scales[hovered] ?? 1) : 1;
  const lift = (s - 1) * m.icon;
  const label = entry.root.getAttribute("aria-label");
  tooltip = el(html`<div class="pointer-events-none absolute left-1/2 z-[1] -translate-x-1/2 transition-[top] duration-100 ease-out" style="top:${-46 - lift}px">
    <svg viewBox="0 0 100 44" class="h-9 min-w-16" style="width:${Math.max(64, label.length * 9 + 24)}px" preserveAspectRatio="none">
      <path d="M 12 0 H 88 Q 100 0 100 12 V 20 Q 100 32 88 32 H 56 L 50 38 L 44 32 H 12 Q 0 32 0 20 V 12 Q 0 0 12 0 Z" class="fill-white/70 dark:fill-zinc-800/70"></path>
    </svg>
    <span class="absolute inset-0 flex items-center justify-center whitespace-nowrap px-3 pb-2 text-xs font-medium text-zinc-800 dark:text-white">${label}</span>
  </div>`);
  entry.root.prepend(tooltip);
}

function resetMagnification() {
  pendingX = null;
  if (frameReq !== null) cancelAnimationFrame(frameReq);
  frameReq = null;
  if (Object.keys(scales).length) {
    scales = {};
    layout();
  }
}

function wireRail() {
  rail.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || !magnification || resizing || e.target.closest('[data-dock-static="true"]')) {
      resetMagnification();
      return;
    }
    pendingX = e.clientX;
    if (frameReq !== null) return;
    frameReq = requestAnimationFrame(() => {
      frameReq = null;
      if (pendingX === null) return;
      const m = metrics();
      const radius = m.icon * C().magnificationRadius;
      const next = {};
      for (const [id, entry] of items) {
        const r = entry.root.getBoundingClientRect();
        const dist = Math.abs(pendingX - (r.left + r.width / 2));
        next[id] = 1 + (C().magnificationScale - 1) * Math.exp(-(dist * dist) / (2 * radius * radius));
      }
      scales = next;
      layout(m);
    });
  });
  rail.addEventListener("pointerleave", () => {
    hovered = null;
    resetMagnification();
    showTooltip();
  });
  rail.addEventListener("mouseover", (e) => {
    const item = e.target.closest("[data-dock-item]");
    const id = item ? item.dataset.dockItem : null;
    if (id !== hovered) {
      hovered = id;
      showTooltip();
    }
  });
  rail.addEventListener("click", (e) => {
    const item = e.target.closest("[data-dock-item]");
    if (!item) return;
    const id = item.dataset.dockItem;
    if (id === "trash") emit("dock:trash");
    else activate(id);
  });
  rail.addEventListener("contextmenu", (e) => {
    const item = e.target.closest("[data-dock-item]");
    if (!item || item.dataset.dockItem === "trash") return;
    e.preventDefault();
    const r = item.getBoundingClientRect();
    openAppMenu(item.dataset.dockItem, { left: r.left + r.width / 2, bottom: window.innerHeight - r.top + 8 });
  });
}

export function activate(appId) {
  const app = wm.getApp(appId);
  emit("dock:activate", appId);
  if (app.multiWindow) {
    if (wm.hasOpenWindows(appId)) wm.bringAppToFront(appId);
    else emit("app:launch-empty", appId);
    return;
  }
  const w = wm.getWindow(appId);
  if (w.isOpen) {
    if (w.isMinimized) wm.unminimizeWindow(appId);
    else wm.focusWindow(appId);
  } else wm.openWindow(appId);
}

// ---------------------------------------------------------------- menus
function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  wm.setMenuOpen(false);
}

function menuButton(action, label, extra) {
  return html`<button type="button" role="menuitem" data-dock-action="${action}" class="${cn(
    "relative z-[1] flex w-full items-center px-3 py-1.5 text-left transition-colors can-hover:hover:bg-blue-500 can-hover:hover:text-white",
    extra,
  )}">${label}</button>`;
}

function openAppMenu(appId, pos) {
  closeMenu();
  hovered = null;
  resetMagnification();
  showTooltip();
  const app = wm.getApp(appId);
  const isOpen = wm.hasOpenWindows(appId);
  const kept = keptInDock(app);
  menuEl = el(html`<div role="menu" aria-label="${t("dock.appMenu", { app: app.name })}"
    class="fixed z-[90] min-w-40 -translate-x-1/2 rounded-lg border border-black/10 bg-white/95 py-1 text-xs shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/95"
    style="left:${pos.left}px;bottom:${pos.bottom}px">
    <span aria-hidden="true" class="absolute left-1/2 top-full h-2 w-3 -translate-x-1/2 bg-white/95 [clip-path:polygon(0_0,100%_0,50%_100%)] dark:bg-zinc-800/95"></span>
    ${!isOpen || !app.canQuit ? menuButton("open", t("dock.open")) : ""}
    ${
      app.canQuit
        ? html`<button type="button" role="menuitemcheckbox" aria-checked="${kept}" data-dock-action="keep"
            class="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left transition-colors can-hover:hover:bg-blue-500 can-hover:hover:text-white">
            <span aria-hidden="true" class="${cn("w-3 text-center text-sm", !kept && "opacity-0")}">${t("dock.check")}</span><span>${t("dock.keep")}</span></button>`
        : ""
    }
    ${isOpen && app.canQuit ? raw(html`<div class="my-1 border-t border-black/10 dark:border-white/10"></div>${menuButton("quit", t("dock.quit"))}`) : ""}
  </div>`);
  document.body.appendChild(menuEl);
  wm.setMenuOpen(true);
  menuEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dock-action]");
    if (!b) return;
    const action = b.dataset.dockAction;
    closeMenu();
    if (action === "open") activate(appId);
    if (action === "quit") wm.closeApp(appId);
    if (action === "keep") {
      keep = { ...keep, [appId]: !kept };
      store.set("localStorage", storageKey("dockKeep"), JSON.stringify(keep));
      reconcile();
    }
  });
  setTimeout(() =>
    document.addEventListener(
      "mousedown",
      function away(e) {
        if (menuEl && !menuEl.contains(e.target)) closeMenu();
        if (menuEl) document.addEventListener("mousedown", away, { once: true });
      },
      { once: true },
    ),
  );
}

function openMagnificationMenu() {
  closeMenu();
  hovered = null;
  resetMagnification();
  menuEl = el(html`<div role="menu" class="absolute bottom-[calc(100%+8px)] left-1/2 z-[90] w-max -translate-x-1/2 rounded-lg border border-black/10 bg-white/95 py-1 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/95">
    <span aria-hidden="true" class="absolute left-1/2 top-full h-2 w-3 -translate-x-1/2 bg-white/95 [clip-path:polygon(0_0,100%_0,50%_100%)] dark:bg-zinc-800/95"></span>
    <button type="button" role="menuitemcheckbox" aria-checked="${magnification}" data-dock-action="magnify"
      class="relative z-[1] flex w-full items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-xs transition-colors can-hover:hover:bg-blue-500 can-hover:hover:text-white">${
        magnification ? t("dock.magnifyOff") : t("dock.magnifyOn")
      }</button>
  </div>`);
  handleWrap.appendChild(menuEl);
  wm.setMenuOpen(true);
  menuEl.addEventListener("click", () => {
    magnification = !magnification;
    store.set("sessionStorage", storageKey("dockMagnification"), String(magnification));
    closeMenu();
    resetMagnification();
  });
  setTimeout(() =>
    document.addEventListener(
      "mousedown",
      (e) => {
        if (menuEl && !menuEl.contains(e.target)) closeMenu();
      },
      { once: true },
    ),
  );
}

function wireHandle() {
  const handle = handleWrap.querySelector("[data-dock-handle]");
  let drag = null;
  const setScale = (v) => {
    const c = C();
    scale = Math.round(Math.min(c.maxScale, Math.max(c.minScale, v)) * 1000) / 1000;
    store.set("sessionStorage", storageKey("dockScale"), String(scale));
    layout();
    refreshCalendarIcon();
  };
  handle.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openMagnificationMenu();
  });
  handle.addEventListener("pointerdown", (e) => {
    if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault();
      openMagnificationMenu();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, y: e.clientY, scale };
    resizing = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
    resetMagnification();
    layout();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const c = C();
    if (e.clientY >= window.innerHeight - 1) return setScale(c.minScale);
    if (e.clientY <= 1) return setScale(c.maxScale);
    setScale(drag.scale + (drag.y - e.clientY) / c.dragPixelsPerScale);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    resizing = false;
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
    layout();
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);
  handle.addEventListener("keydown", (e) => {
    const c = C();
    const map = {
      ArrowUp: scale + c.scaleStep,
      ArrowDown: scale - c.scaleStep,
      Home: c.minScale,
      End: c.maxScale,
    };
    if (e.key in map) {
      e.preventDefault();
      setScale(map[e.key]);
    }
  });
}
