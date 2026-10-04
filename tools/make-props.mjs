// Builds the TEST componentProps: the app registry, OS versions and icons (props/data/*.json — frozen
// from the original Next.js project this was ported from), strings, theme tokens and the notes fixture.
// These are the values a record's `props` column carries; the page itself holds none of them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UCA_DIR, NOTES } from "./shared.mjs";

const data = (name) => JSON.parse(readFileSync(join(UCA_DIR, `props/data/${name}.json`), "utf8"));
const ICONS = data("icons");

const STRINGS = {
  "window.close": "Close window",
  "window.minimize": "Minimize window",
  "window.maximize": "Maximize window",
  "window.restore": "Restore window",
  "apple.label": "Apple menu",
  "apple.about": "About This Mac",
  "apple.settings": "System Settings...",
  "apple.sleep": "Sleep",
  "apple.restart": "Restart...",
  "apple.shutdown": "Shut Down...",
  "apple.lock": "Lock Screen",
  "apple.logout": "Log Out {user}...",
  "app.about": "About {app}",
  "app.quit": "Quit {app}",
  "menu.file": "File",
  "status.battery": "Battery, 97%",
  "status.wifi": "Wi-Fi",
  "status.controlCenter": "Control Center",
  "dock.resize": "Resize Dock",
  "dock.trash": "Trash",
  "dock.open": "Open",
  "dock.keep": "Keep in Dock",
  "dock.quit": "Quit",
  "dock.check": "✓",
  "dock.appMenu": "{app} Dock menu",
  "dock.magnifyOn": "Turn Magnification On",
  "dock.magnifyOff": "Turn Magnification Off",
  "desktop.wallpaperAlt": "Desktop wallpaper",
  "overlay.wake": "Wake",
  "overlay.unlock": "Unlock",
  "overlay.powerOn": "Power on",
  "overlay.bootLogoAlt": "1ovr1",
  "overlay.touchId": "Touch ID or Enter Password",
  "theme.label": "Theme",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
  "phone.bar": "Apps",
  "phone.toggleBar": "Show or hide the app bar",
  "phone.badgeLabel": "{app}, {count} new",
  "record.loading": "Loading {app}…",
  "record.failed": "{app} couldn't load ({reason}).",
  "record.empty": "the record returned an empty page",
  "pending.body": "{app} is still being ported to the UCA build. It will appear here in a later phase.",
  "notes.displayOptions": "Notes display options",
  "notes.newNote": "New Note",
  "notes.search": "Search",
  "notes.searchLabel": "Search notes",
  "notes.clearSearch": "Clear search",
  "notes.listLabel": "Notes list",
  "notes.noResults": "No results found",
  "notes.dateAt": "{date} at {time}",
  "notes.private": "Private",
  "notes.titlePlaceholder": "Your title here...",
  "notes.bodyPlaceholder": "Start writing...",
  "notes.back": "Notes",
  "notes.sortBy": "Sort By",
  "notes.groupByDate": "Group By Date",
  "notes.sortMenu": "Sort notes",
  "notes.groupMenu": "Group notes by date",
  "notes.ascending": "Ascending",
  "notes.descending": "Descending",
  "notes.newestFirst": "Newest First",
  "notes.oldestFirst": "Oldest First",
  "notes.pin": "Pin Note",
  "notes.unpin": "Unpin Note",
  "notes.delete": "Delete Note",
};

// Apps that are their own records in the 1ovr1 database (record id = view_id).
const RECORDS = { messages: 74 };

// ---------------------------------------------------------------- props
export async function makeTestProps({ theme, assetBase }) {
  const APPS = data("apps");
  const OS_VERSIONS = data("os-versions");

  const assets = {
    trash: `${assetBase}trash.png`,
    avatar: `${assetBase}headshot.jpg`,
    bootLogo: "https://storage.googleapis.com/xsxx-a39r-0vrj.n7e.xano.io/vault/Mnkcxzwv/einxV-Okg8ydi0B5SQ69dA3RKHc/WR46_A../1ovr1%20logo.JPG",
  };
  const apps = APPS.map((a) => {
    const key = a.icon.replace(/^\//, "").replace(/\.png$/, "");
    assets[key] = `${assetBase}${a.icon.replace(/^\//, "")}`;
    return {
      id: a.id,
      name: a.name,
      icon: key,
      description: a.description,
      accentColor: a.accentColor,
      menuBarTitle: a.menuBarTitle,
      defaultPosition: a.defaultPosition,
      defaultSize: a.defaultSize,
      minSize: a.minSize,
      dockOrder: a.dockOrder ?? null,
      dockIconScale: a.dockIconScale ?? 1,
      showOnDockByDefault: a.showOnDockByDefault !== false,
      multiWindow: Boolean(a.multiWindow),
      cascadeOffset: a.cascadeOffset ?? 0,
      canQuit: a.id !== "finder",
      alwaysShowsOpenIndicator: a.id === "finder",
      mobile: { supported: a.mobile.supported },
      // Set when the app is built as its own record; the shell then loads it like an appshell tab.
      view_id: RECORDS[a.id] ?? null,
    };
  });
  // Phone bar: the apps the original supports on phones, in Dock order.
  const byDock = [...apps].sort((l, r) => (l.dockOrder ?? Infinity) - (r.dockOrder ?? Infinity));
  const barAppIds = byDock.filter((a) => a.mobile.supported).map((a) => a.id);
  // Wallpapers: original file plus, where available, the resized copies the original site
  // served through next/image (assets/wallpapers/<os>-<width>.webp).
  const WIDTHS = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
  const wallpapers = {};
  for (const os of OS_VERSIONS) {
    const sized = existsSync(join(UCA_DIR, `assets/wallpapers/${os.id}-640.webp`));
    wallpapers[os.id] = {
      name: os.name,
      src: sized
        ? `${assetBase}wallpapers/${os.id}-3840.webp`
        : `${assetBase}desktop/versions/${os.wallpaperFile}`,
      srcset: sized ? WIDTHS.map((w) => `${assetBase}wallpapers/${os.id}-${w}.webp ${w}w`).join(", ") : null,
    };
  }

  return {
    meta: { title: "alana goyal", previewTitle: "Phonemac Desktop", description: "Personal website of Alana Goyal", version: "uca-phase-1" },
    user: { displayName: "Alana Goyal", username: "alanagoyal", avatarUrl: assets.avatar },
    shell: { weight: "dom" },
    features: { portedApps: ["notes"] },
    apps,
    responsive: { mobileFallbackAppId: "notes" },
    config: {
      viewEndpoint: "https://api.1ovr1.com/api:9yDRTI1I/viewer",
      pagesEndpoint: "https://api.1ovr1.com/api:o-B1LTj7/get_pages",
    },
    phone: {
      barAppIds,
      barHeight: 52,
      handleHeight: 8,
      itemSize: 44,
      iconSize: 34,
      gap: 2,
      paddingX: 8,
      dotSize: 4,
      warmLimit: 4,
      swipeThreshold: 50,
      tapSlop: 10,
    },
    formats: { locale: "en-US" },
    storage: {
      windowLayout: "pc-desktop-window-layout",
      systemSettings: "pc-system-settings",
      dockKeep: "pc-dock-keep-overrides",
      dockScale: "pc-dock-scale",
      dockMagnification: "pc-dock-magnification",
      notesSession: "session_id",
      privateNotes: "pc-private-notes",
      pinnedNotes: "pinnedNotes",
      phoneState: "pc-phone-state",
      appStatePrefix: "pc-app-state:",
      appRoutePrefix: "pc-app-route:",
    },
    settings: {
      defaults: {
        appearance: "system",
        osVersion: "sierra",
        wallpaperUrl: null,
        focusMode: "off",
        menuBarBackground: false,
        clockShowDate: true,
        clockShowDayOfWeek: true,
        clockStyle: "digital",
        clockShowAmPm: true,
        clockFlashSeparators: false,
        clockShowSeconds: false,
      },
    },
    desktop: {
      menuBarHeight: 28,
      menuAvatarSize: 18,
      dockHeight: 80,
      windowDockGap: 12,
      windowZMax: 50,
      maximizedZIndex: 80,
      resizeCorner: 12,
      resizeEdge: 6,
      defaultMenuAppId: "finder",
      trashAppId: "finder",
      defaultLayout: {
        windows: [
          { appId: "messages", position: { x: 500, y: 60 }, size: null },
          { appId: "notes", position: { x: 150, y: 40 }, size: { width: 1000, height: 700 } },
        ],
        focusedAppId: "notes",
      },
      wallpapers,
      boot: { stepMs: 150, stepPercent: 5, finishDelayMs: 500, background: "#262626", logoHeight: 200, logoGap: 0 },
    },
    dock: {
      iconSize: 48,
      gap: 4,
      paddingX: 12,
      paddingY: 6,
      dividerHeight: 48,
      dividerMarginX: 4,
      dotSize: 4,
      badgeHeight: 20,
      badgeMinWidth: 20,
      badgePaddingX: 4,
      badgeFontSize: 11,
      handleHitboxWidth: 14,
      handleLineWidth: 1,
      minScale: 0.7,
      maxScale: 1.6,
      scaleStep: 0.05,
      dragPixelsPerScale: 220,
      magnificationScale: 1.4,
      magnificationRadius: 0.88,
      calendarIconRatio: 0.79,
      edgeMargin: 8,
      enterMs: 700,
      exitMs: 350,
    },
    notesApp: {
      defaultSlug: "about-me",
      defaultPinned: ["about-me", "quick-links"],
      newNoteEmoji: "👋🏼",
      saveDebounceMs: 500,
      defaultDisplay: { groupMode: "edited", sortField: "default", sortDirection: "newest" },
      displayStorageKeys: {
        groupMode: "notes-group-mode",
        sortField: "notes-sort-field",
        sortDirection: "notes-sort-direction",
      },
      categoryLabels: {
        pinned: "Pinned",
        notes: "Notes",
        today: "Today",
        yesterday: "Yesterday",
        7: "Previous 7 Days",
        30: "Previous 30 Days",
        older: "Older",
      },
      sortLabels: { default: "Default (Date Edited)", edited: "Date Edited", created: "Date Created", title: "Title" },
      groupLabels: { edited: "Date Edited", created: "Date Created", off: "Off" },
    },
    notes: NOTES,
    strings: STRINGS,
    icons: ICONS,
    assets,
    theme,
  };
}
