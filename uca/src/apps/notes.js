// Notes app (plain JS port). Public notes come from componentProps.notes; notes the viewer
// writes are private to this browser (localStorage) until a Xano notes endpoint is configured.
import { need, t, emit, on, el, html, raw, cn, icon, store, storageKey } from "../core.js";
import { renderMarkdown } from "../markdown.js";
import { registerAppMenus } from "../menubar.js";
import {
  groupNotesByTimestamp,
  sortNotes,
  getNotePreviewText,
} from "../../../lib/notes/note-utils";
import {
  withDisplayCreatedAtForNotes,
  getDisplayCreatedAt,
} from "../../../lib/notes/display-created-at";

const CATEGORY_ORDER = ["pinned", "today", "yesterday", "7", "30", "older"];
const UNGROUPED_ORDER = ["pinned", "notes"];
const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[13px] leading-5 transition-colors can-hover:hover:bg-notes-highlight can-hover:hover:text-black dark:can-hover:hover:bg-notes-highlight-dark dark:can-hover:hover:text-white focus-visible:bg-notes-highlight focus-visible:text-black dark:focus-visible:bg-notes-highlight-dark dark:focus-visible:text-white focus-visible:outline-none";
const POPOVER =
  "rounded-xl border border-black/10 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/95";

// ---------------------------------------------------------------- shared data
const data = {
  loaded: false,
  publicNotes: [],
  privateNotes: [],
  sessionId: "",
  pinned: new Set(),
};

function sessionId() {
  if (!data.sessionId) {
    const key = storageKey("notesSession");
    let id = store.get("localStorage", key);
    if (!id) {
      id = crypto.randomUUID();
      store.set("localStorage", key, id);
    }
    data.sessionId = id;
  }
  return data.sessionId;
}

function load() {
  if (data.loaded) return;
  data.loaded = true;
  const sid = sessionId();
  data.publicNotes = withDisplayCreatedAtForNotes(need("notes").filter((n) => n.public));
  const saved = store.json("localStorage", storageKey("privateNotes"));
  data.privateNotes = Array.isArray(saved) ? saved.filter((n) => n.session_id === sid) : [];
  const pinned = store.json("sessionStorage", storageKey("pinnedNotes"));
  if (Array.isArray(pinned)) data.pinned = new Set(pinned);
  else {
    data.pinned = new Set([...need("notesApp.defaultPinned"), ...data.privateNotes.map((n) => n.slug)]);
    savePinned();
  }
}

const allNotes = () => [...data.publicNotes, ...data.privateNotes];
const findNote = (slug) => allNotes().find((n) => n.slug === slug) ?? null;
const savePrivate = () => store.set("localStorage", storageKey("privateNotes"), JSON.stringify(data.privateNotes));
const savePinned = () => store.set("sessionStorage", storageKey("pinnedNotes"), JSON.stringify([...data.pinned]));

function loadPrefs() {
  const d = need("notesApp.defaultDisplay");
  const k = need("notesApp.displayStorageKeys");
  const pick = (key, allowed, fallbackValue) => {
    const v = store.get("sessionStorage", key) ?? store.get("localStorage", key);
    return allowed.includes(v) ? v : fallbackValue;
  };
  return {
    groupMode: pick(k.groupMode, ["edited", "created", "off"], d.groupMode),
    sortField: pick(k.sortField, ["default", "edited", "created", "title"], d.sortField),
    sortDirection: pick(k.sortDirection, ["newest", "oldest"], d.sortDirection),
  };
}

function savePrefs(p) {
  const k = need("notesApp.displayStorageKeys");
  store.set("sessionStorage", k.groupMode, p.groupMode);
  store.set("sessionStorage", k.sortField, p.sortField);
  store.set("sessionStorage", k.sortDirection, p.sortDirection);
}

const fmtListDate = (note) =>
  new Date(getDisplayCreatedAt(note)).toLocaleDateString(need("formats.locale"));

function fmtHeaderDate(note) {
  const d = new Date(getDisplayCreatedAt(note));
  const locale = need("formats.locale");
  const date = d.toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", hour12: true });
  return t("notes.dateAt", { date, time });
}

// ---------------------------------------------------------------- app instance
export function createNotesApp(ctx, { mobile = false, initialSlug = null } = {}) {
  load();
  const sid = sessionId();
  const prefs = loadPrefs();
  const ui = {
    selected: initialSlug && findNote(initialSlug) ? initialSlug : null,
    query: "",
    results: null,
    highlighted: 0,
    editing: false,
    menuOpen: false,
    submenu: null,
    mobileDetail: Boolean(initialSlug),
  };
  if (!ui.selected && !mobile) ui.selected = need("notesApp.defaultSlug");

  const root = el(html`<div data-app="notes" tabindex="-1"
    class="${cn("notes-app h-full flex text-foreground relative outline-none", mobile ? "bg-background" : "bg-background")}"></div>`);

  // Sidebar ------------------------------------------------------------
  const sidebar = el(
    `<div class="${cn(
      "flex h-full flex-col",
      mobile ? "w-full max-w-full bg-[#F2F2F7] dark:bg-black" : "w-[320px] border-r border-muted-foreground/20 bg-muted",
    )}"></div>`,
  );
  const nav = el(html`<div data-window-drag-handle="true" class="${cn(
    "px-4 py-2 flex items-center sticky top-0 z-[1] select-none",
    mobile ? "bg-[#F2F2F7] dark:bg-black" : "bg-muted",
  )}">
    <div class="shrink-0"><div class="flex items-center gap-1">${raw(ctx.controls("p-2"))}</div></div>
    <div class="flex-1"></div>
    <div class="shrink-0">
      <div class="relative flex items-center gap-0.5" data-nav-right>
        <button type="button" aria-label="${t("notes.displayOptions")}" aria-haspopup="dialog" aria-expanded="false" data-action="options"
          class="flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-muted-foreground transition-colors can-hover:hover:bg-muted-foreground/10 can-hover:hover:text-foreground">${icon("ellipsis", "h-5 w-5")}</button>
        <div class="flex flex-col items-center justify-center">
          <button type="button" aria-label="${t("notes.newNote")}" data-action="new" class="${cn("desktop:p-2 hover:bg-muted-foreground/10 rounded-lg", mobile && "p-2")}">${icon("penSquare", "text-muted-foreground h-4 w-4")}</button>
        </div>
      </div>
    </div>
  </div>`);
  const scroller = el(`<div class="relative flex-1 min-h-0 overflow-hidden"><div class="h-full overflow-y-auto pc-scroll-hidden" data-list-scroll></div></div>`);
  const listScroll = scroller.firstElementChild;
  const listInner = el(html`<div class="flex w-full flex-col"><div class="${mobile ? "w-full px-2" : "px-2 w-[320px]"}">
    <div class=""><div class="p-2"><div class="relative">
      <div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">${icon("search", "text-muted-foreground h-[14px] w-[14px]")}</div>
      <input id="search" type="text" placeholder="${t("notes.search")}" aria-label="${t("notes.searchLabel")}" autocomplete="off"
        class="w-full pl-8 pr-8 py-0.5 rounded-lg text-base desktop:text-sm placeholder:text-sm focus:outline-none border border-muted-foreground/20 dark:border-none dark:bg-notes-search-dark" data-search>
      <button type="button" hidden data-action="clear-search" aria-label="${t("notes.clearSearch")}"
        class="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground">${icon("x", "h-4 w-4 text-muted-foreground")}</button>
    </div></div></div>
    <div class="py-2"><nav aria-label="${t("notes.listLabel")}" data-list></nav></div>
  </div></div>`);
  listScroll.appendChild(listInner);
  sidebar.append(nav, scroller);
  const listEl = listInner.querySelector("[data-list]");
  const searchInput = listInner.querySelector("[data-search]");
  const clearBtn = listInner.querySelector("[data-action='clear-search']");
  const navRight = nav.querySelector("[data-nav-right]");

  // Content pane ---------------------------------------------------------
  const content = el(`<div class="flex-grow h-full overflow-hidden relative"></div>`);
  const dragStrip = el(`<div class="absolute top-0 left-0 right-0 h-[52px] z-10 select-none"></div>`);
  const contentScroll = el(`<div class="h-full overflow-y-auto pc-scroll-hidden"></div>`);
  content.append(dragStrip, contentScroll);

  root.appendChild(sidebar);
  if (!mobile) root.appendChild(content);

  // ---------------------------------------------------------------- derived
  function grouped() {
    const visible = allNotes().filter((n) => n.public || n.session_id === sid);
    const groupMode = prefs.sortField === "title" ? "off" : prefs.groupMode;
    let g;
    if (groupMode !== "off") {
      const select = groupMode === "created" ? (n) => n.created_at : (n) => getDisplayCreatedAt(n);
      g = groupNotesByTimestamp(visible, data.pinned, select);
    } else {
      g = {
        pinned: visible.filter((n) => data.pinned.has(n.slug)),
        notes: visible.filter((n) => !data.pinned.has(n.slug)),
      };
    }
    for (const k of Object.keys(g)) g[k] = sortNotes(g[k], prefs.sortField, prefs.sortDirection);
    return { g, order: groupMode === "off" ? UNGROUPED_ORDER : CATEGORY_ORDER };
  }

  const flattened = () => {
    const { g, order } = grouped();
    return order.flatMap((k) => g[k] ?? []);
  };

  const orderedResults = () => (ui.results ? sortNotes(ui.results, prefs.sortField, prefs.sortDirection) : null);

  function highlightedNote() {
    const r = orderedResults();
    if (r && r.length) return r[ui.highlighted] ?? null;
    return ui.selected ? findNote(ui.selected) : null;
  }

  // ---------------------------------------------------------------- render: list
  function itemHtml(note, { highlighted, divider }) {
    const active = !mobile && highlighted;
    const li = html`<li tabindex="0" data-slug="${note.slug}" class="${cn(
      "h-[70px] w-full",
      active && "bg-notes-highlight dark:bg-notes-highlight-dark dark:text-white rounded-md",
      !mobile && divider && !highlighted && 'after:content-[""] after:block after:mx-2 after:border-t after:border-muted-foreground/20',
    )}">
      <div data-note-slug="${note.slug}" class="h-full w-full px-4">
        <button type="button" tabindex="-1" data-select="${note.slug}" class="block py-2 h-full w-full flex flex-col justify-center text-left">
          <h2 class="text-sm font-bold px-2 break-words line-clamp-1">${note.emoji} ${note.title}</h2>
          <p class="${cn("text-xs pl-2 flex items-baseline overflow-hidden", active ? "text-muted-foreground dark:text-white/80" : "text-muted-foreground")}">
            <span class="text-black dark:text-white shrink-0"><span class="inline-block whitespace-nowrap mr-1 tabular-nums visible">${fmtListDate(note)}</span></span>
            <span class="block w-0 min-w-0 flex-1 truncate">${getNotePreviewText(note.content)}</span>
          </p>
        </button>
      </div>
    </li>`;
    if (!mobile) return li;
    // Phone rows: the divider sits on a wrapper below the 70px row, as in the original.
    return html`<div class="relative overflow-hidden"><div data-note-slug="${note.slug}" class="${cn(
      "transition-transform duration-300 ease-out w-full",
      divider && 'after:content-[""] after:block after:mx-6 after:border-t after:border-muted-foreground/20',
    )}">${li}</div></div>`;
  }

  function renderList() {
    const results = orderedResults();
    if (results) {
      listEl.innerHTML = results.length
        ? html`<ul>${results.map((n, i) =>
            itemHtml(n, { highlighted: i === ui.highlighted, divider: i < results.length - 1 }),
          )}</ul>`
        : html`<p class="px-2 text-sm text-muted-foreground">${t("notes.noResults")}</p>`;
      return;
    }
    const { g, order } = grouped();
    const labels = need("notesApp.categoryLabels");
    listEl.innerHTML = order
      .filter((k) => g[k] && g[k].length)
      .map(
        (k) => html`<section><h3 class="ml-2 py-1 text-xs font-bold text-muted-foreground">${labels[k]}</h3><ul>${g[k].map((n, i) =>
          itemHtml(n, { highlighted: n.slug === ui.selected, divider: i < g[k].length - 1 }),
        )}</ul></section>`,
      )
      .join("");
  }

  // ---------------------------------------------------------------- render: note
  function canEdit(note) {
    return !note.public && note.session_id === sid;
  }

  function renderNote() {
    const note = ui.selected ? findNote(ui.selected) : null;
    const host = mobile ? listScroll : contentScroll;
    if (!note) {
      if (!mobile) contentScroll.innerHTML = "";
      return;
    }
    const editable = canEdit(note);
    const editing = editable && (ui.editing || !note.content);
    host.innerHTML = html`<div class="${cn("w-full min-h-full", mobile ? "p-3 bg-background" : "p-3")}">
      <div class="h-full overflow-y-auto bg-background" data-note-root>
        ${mobile ? html`<button type="button" data-action="back" class="pt-2 flex items-center">${icon("chevronLeft", "text-notes-link h-5 w-5")}<span class="text-notes-link text-base ml-1">${t("notes.back")}</span></button>` : ""}
        <div class="px-2 mb-4 relative">
          <div class="relative flex min-h-6 items-center justify-center">
            <p class="text-muted-foreground text-xs"><span class="visible">${fmtHeaderDate(note)}</span></p>
            ${
              mobile
                ? ""
                : html`<div class="ml-2 flex h-6 items-center"><div aria-hidden="${note.public}" class="${cn(
                    "inline-flex rounded-full border px-2.5 py-0.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent text-xs justify-center items-center bg-muted-foreground/70 can-hover:hover:bg-muted-foreground/70 text-white/90",
                    note.public ? "invisible" : "visible",
                  )}">${icon("lock", "w-3 h-3 mr-1")}${t("notes.private")}</div></div>`
            }
          </div>
          <div class="flex items-center relative">
            <span class="mr-2">${note.emoji}</span>
            ${
              note.public
                ? html`<span class="text-2xl font-bold flex-grow py-2 leading-normal min-h-[50px]">${note.title}</span>`
                : html`<input id="title" value="${note.title}" ${raw(editable ? "" : "readonly")} placeholder="${editable ? t("notes.titlePlaceholder") : ""}" data-title
                    class="flex h-10 w-full rounded-md disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none bg-background placeholder:text-muted-foreground text-2xl font-bold flex-grow py-2 leading-normal min-h-[50px]">`
            }
          </div>
        </div>
        <div class="relative"><div class="relative z-10"><div class="px-2 relative">
          ${
            editing
              ? html`<textarea id="note-content" data-editor placeholder="${t("notes.bodyPlaceholder")}"
                  class="flex h-full w-full rounded-md bg-background text-base desktop:text-sm placeholder:text-muted-foreground focus:outline-none min-h-[100px] leading-normal resize-none overflow-hidden">${note.content}</textarea>`
              : html`<div class="text-base desktop:text-sm" data-markdown>${raw(
                  renderMarkdown(note.content || t("notes.bodyPlaceholder"), { editable }),
                )}</div>`
          }
        </div></div></div>
      </div>
    </div>`;
    const editor = host.querySelector("[data-editor]");
    if (editor) {
      autosize(editor);
      if (ui.editing) editor.focus();
    }
  }

  function autosize(ta) {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  function renderAll() {
    if (mobile) {
      if (ui.mobileDetail && ui.selected) {
        nav.hidden = true;
        listScroll.replaceChildren();
        renderNote();
      } else {
        nav.hidden = false;
        if (listScroll.firstElementChild !== listInner) listScroll.replaceChildren(listInner);
        renderList();
      }
      return;
    }
    renderList();
    renderNote();
  }

  // ---------------------------------------------------------------- actions
  function select(slug) {
    if (!findNote(slug)) return;
    ui.selected = slug;
    ui.editing = false;
    if (mobile) ui.mobileDetail = true;
    clearSearch(false);
    renderAll();
    emit("route:set", `notes/${slug}`);
    listEl.querySelector(`[data-note-slug="${CSS.escape(slug)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function clearSearch(rerender = true) {
    ui.query = "";
    ui.results = null;
    ui.highlighted = 0;
    searchInput.value = "";
    clearBtn.hidden = true;
    if (rerender) renderList();
  }

  function onSearch(q) {
    ui.query = q;
    clearBtn.hidden = !q;
    if (!q.trim()) return clearSearch();
    const term = q.trim().toLowerCase();
    ui.results = allNotes().filter(
      (n) =>
        (n.public || n.session_id === sid) &&
        (n.title.toLowerCase().includes(term) || n.content.toLowerCase().includes(term)),
    );
    ui.highlighted = 0;
    renderList();
  }

  function togglePin(slug) {
    if (data.pinned.has(slug)) data.pinned.delete(slug);
    else data.pinned.add(slug);
    savePinned();
    emit("notes:changed");
  }

  function createNote() {
    clearSearch(false);
    const id = crypto.randomUUID();
    const note = {
      id,
      slug: `new-note-${id}`,
      title: "",
      content: "",
      public: false,
      created_at: new Date().toISOString(),
      display_created_at: new Date().toISOString(),
      session_id: sid,
      category: "today",
      emoji: need("notesApp.newNoteEmoji"),
    };
    data.privateNotes.push(note);
    data.pinned.add(note.slug);
    savePrivate();
    savePinned();
    ui.selected = note.slug;
    ui.editing = true;
    if (mobile) ui.mobileDetail = true;
    emit("notes:changed");
  }

  function deleteNote(note) {
    if (!note || note.public || note.session_id !== sid) return;
    const flat = flattened();
    const idx = flat.findIndex((n) => n.slug === note.slug);
    const next = idx === 0 ? flat[1] : flat[idx - 1];
    data.privateNotes = data.privateNotes.filter((n) => n.slug !== note.slug);
    data.pinned.delete(note.slug);
    savePrivate();
    savePinned();
    if (ui.selected === note.slug) ui.selected = !mobile && next ? next.slug : null;
    clearSearch(false);
    emit("notes:changed");
  }

  let saveTimer = null;
  function updateNote(note, patch) {
    Object.assign(note, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      savePrivate();
      renderList();
    }, need("notesApp.saveDebounceMs"));
  }

  function navigate(dir) {
    const r = orderedResults();
    if (r && r.length) {
      ui.highlighted = (ui.highlighted + dir + r.length) % r.length;
      renderList();
      return;
    }
    const flat = flattened();
    const i = flat.findIndex((n) => n.slug === ui.selected);
    const next = dir > 0 ? (i < flat.length - 1 ? i + 1 : 0) : i > 0 ? i - 1 : flat.length - 1;
    if (flat[next]) select(flat[next].slug);
  }

  // ---------------------------------------------------------------- options popover
  let popover = null;
  function closeOptions() {
    popover?.remove();
    popover = null;
    ui.submenu = null;
    navRight.querySelector("[data-action='options']").setAttribute("aria-expanded", "false");
  }

  function check(on) {
    return icon("check", cn("h-4 w-4 shrink-0", !on && "opacity-0"));
  }

  function renderOptions() {
    const groupDisabled = prefs.sortField === "title";
    const dir = groupDisabled ? [t("notes.ascending"), t("notes.descending")] : [t("notes.newestFirst"), t("notes.oldestFirst")];
    const sortLabels = need("notesApp.sortLabels");
    const groupLabels = need("notesApp.groupLabels");
    const markup = html`<div class="${cn("absolute right-0 top-full mt-1 z-50 w-56 overflow-visible", POPOVER)}" data-options>
      <div role="menu" aria-label="${t("notes.displayOptions")}">
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="${ui.submenu === "sort"}" data-sub="sort" class="${MENU_ITEM}">
          ${icon("arrowUpDown", "h-4 w-4 shrink-0")}<span class="flex-1">${t("notes.sortBy")}</span>${icon("chevronRight", "h-4 w-4 shrink-0")}
        </button>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="${ui.submenu === "group"}" aria-disabled="${groupDisabled}" ${raw(groupDisabled ? "disabled" : "")} data-sub="group"
          class="${cn(MENU_ITEM, groupDisabled && "cursor-default opacity-45 can-hover:hover:bg-transparent can-hover:hover:text-inherit dark:can-hover:hover:bg-transparent dark:can-hover:hover:text-inherit")}">
          ${icon("calendarDays", "h-4 w-4 shrink-0")}<span class="flex-1">${t("notes.groupByDate")}</span>${icon("chevronRight", "h-4 w-4 shrink-0")}
        </button>
      </div>
      ${
        ui.submenu === "sort"
          ? html`<div role="menu" aria-label="${t("notes.sortMenu")}" class="${cn("absolute top-1.5 w-60 left-[calc(100%-2px)]", POPOVER)}">
              ${Object.entries(sortLabels).map(
                ([field, label]) => html`<button type="button" role="menuitemradio" aria-checked="${prefs.sortField === field}" data-sort="${field}" class="${MENU_ITEM}">${check(prefs.sortField === field)}<span>${label}</span></button>`,
              )}
              <div class="my-1 border-t border-muted-foreground/20"></div>
              ${["newest", "oldest"].map(
                (d, i) => html`<button type="button" role="menuitemradio" aria-checked="${prefs.sortDirection === d}" data-dir="${d}" class="${MENU_ITEM}">${check(prefs.sortDirection === d)}<span>${dir[i]}</span></button>`,
              )}
            </div>`
          : ""
      }
      ${
        ui.submenu === "group" && !groupDisabled
          ? html`<div role="menu" aria-label="${t("notes.groupMenu")}" class="${cn("absolute top-[40px] w-48 left-[calc(100%-2px)]", POPOVER)}">
              ${Object.entries(groupLabels).map(
                ([mode, label]) => html`<button type="button" role="menuitemradio" aria-checked="${prefs.groupMode === mode}" data-group="${mode}" class="${MENU_ITEM}">${check(prefs.groupMode === mode)}<span>${label}</span></button>`,
              )}
            </div>`
          : ""
      }
    </div>`;
    const next = el(markup);
    if (popover) popover.replaceWith(next);
    else navRight.appendChild(next);
    popover = next;
    navRight.querySelector("[data-action='options']").setAttribute("aria-expanded", "true");
  }

  // ---------------------------------------------------------------- events
  nav.addEventListener("mousedown", (e) => {
    if (e.target.closest("[data-nav-right]")) return;
    ctx.startDrag(e);
  });
  dragStrip.addEventListener("mousedown", (e) => {
    // The strip drags the window; a click without movement falls through to what is below it.
    const start = { x: e.clientX, y: e.clientY };
    let dragged = false;
    const move = (ev) => {
      if (!dragged && (Math.abs(ev.clientX - start.x) > 5 || Math.abs(ev.clientY - start.y) > 5)) {
        dragged = true;
        ctx.startDrag(e);
      }
    };
    const up = (ev) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      if (!dragged) {
        dragStrip.style.pointerEvents = "none";
        const below = document.elementFromPoint(ev.clientX, ev.clientY);
        dragStrip.style.pointerEvents = "";
        if (below && below !== dragStrip) below.click();
      }
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });

  root.addEventListener("click", (e) => {
    const t0 = e.target;
    if (t0.closest("[data-action='new']")) return createNote();
    if (t0.closest("[data-action='back']")) {
      ui.mobileDetail = false;
      ui.editing = false;
      emit("route:set", "notes");
      return renderAll();
    }
    if (t0.closest("[data-action='clear-search']")) return clearSearch();
    if (t0.closest("[data-action='options']")) {
      if (popover) closeOptions();
      else renderOptions();
      return;
    }
    const sub = t0.closest("[data-sub]");
    if (sub && !sub.disabled) {
      ui.submenu = ui.submenu === sub.dataset.sub ? null : sub.dataset.sub;
      return renderOptions();
    }
    const sortBtn = t0.closest("[data-sort]");
    const dirBtn = t0.closest("[data-dir]");
    const groupBtn = t0.closest("[data-group]");
    if (sortBtn || dirBtn || groupBtn) {
      if (sortBtn) prefs.sortField = sortBtn.dataset.sort;
      if (dirBtn) prefs.sortDirection = dirBtn.dataset.dir;
      if (groupBtn) prefs.groupMode = groupBtn.dataset.group;
      savePrefs(prefs);
      renderList();
      return renderOptions();
    }
    const pick = t0.closest("[data-select]");
    if (pick) return select(pick.dataset.select);

    const box = t0.closest("[data-task]");
    if (box) {
      const note = findNote(ui.selected);
      if (note && canEdit(note)) {
        const text = box.dataset.task;
        const checked = box.dataset.checked === "true";
        const pattern = new RegExp(`\\[[ x]\\] ${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
        updateNote(note, { content: note.content.replace(pattern, `[${checked ? " " : "x"}] ${text}`) });
        renderNote();
      }
      return;
    }
    const md = t0.closest("[data-markdown]");
    if (md && !t0.closest("a, button, input, textarea")) {
      const note = findNote(ui.selected);
      if (note && canEdit(note)) {
        ui.editing = true;
        renderNote();
      }
      return;
    }
    if (ui.editing && !t0.closest("[data-editor], [data-title]") && t0.closest("[data-note-root]")) {
      ui.editing = false;
      renderNote();
    }
  });

  root.addEventListener("mouseover", (e) => {
    const sub = e.target.closest("[data-sub]");
    if (sub && !mobile && !sub.disabled && ui.submenu !== sub.dataset.sub) {
      ui.submenu = sub.dataset.sub;
      renderOptions();
    }
  });

  root.addEventListener("input", (e) => {
    if (e.target === searchInput) return onSearch(searchInput.value);
    const note = findNote(ui.selected);
    if (!note || !canEdit(note)) return;
    if (e.target.matches("[data-editor]")) {
      autosize(e.target);
      updateNote(note, { content: e.target.value });
    }
    if (e.target.matches("[data-title]")) updateNote(note, { title: e.target.value });
  });

  root.addEventListener("keydown", (e) => {
    if (e.target.matches("[data-editor]") && e.key === "Escape") {
      ui.editing = false;
      renderNote();
    }
  });

  const onDocMouseDown = (e) => {
    if (popover && !navRight.contains(e.target)) closeOptions();
  };
  document.addEventListener("mousedown", onDocMouseDown);

  const shortcuts = {
    j: () => navigate(1),
    ArrowDown: () => navigate(1),
    k: () => navigate(-1),
    ArrowUp: () => navigate(-1),
    p: () => {
      const n = highlightedNote();
      if (n) togglePin(n.slug);
    },
    d: () => deleteNote(highlightedNote()),
    n: () => createNote(),
    "/": () => searchInput.focus(),
    Escape: () => document.activeElement?.blur(),
  };
  const onKey = (e) => {
    if (!ctx.isFocused()) return;
    const target = e.target;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    if (typing) {
      if (e.key === "Escape") shortcuts.Escape();
      else if (e.key === "Enter" && target === searchInput) {
        const r = orderedResults();
        if (r && r[ui.highlighted]) {
          e.preventDefault();
          select(r[ui.highlighted].slug);
        }
      }
      return;
    }
    if (shortcuts[e.key] && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      document.activeElement?.blur?.();
      shortcuts[e.key]();
    }
  };
  window.addEventListener("keydown", onKey);

  const offChanged = on("notes:changed", renderAll);

  // Menu-bar "File" menu while Notes is focused.
  registerAppMenus("notes", () => [
    {
      id: "notesFile",
      label: t("menu.file"),
      panelClass: "left-[120px]",
      items: () => {
        const n = highlightedNote();
        const pinned = n ? data.pinned.has(n.slug) : false;
        return [
          { id: "new-note", label: t("notes.newNote"), shortcut: "N", run: createNote },
          { id: "pin-note", label: pinned ? t("notes.unpin") : t("notes.pin"), shortcut: "P", run: () => n && togglePin(n.slug) },
          { id: "delete-note", label: t("notes.delete"), shortcut: "D", run: () => deleteNote(n) },
        ];
      },
    },
  ]);

  renderAll();

  return {
    el: root,
    update() {},
    route(slug) {
      if (slug) select(slug);
    },
    destroy() {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocMouseDown);
      offChanged();
    },
  };
}
