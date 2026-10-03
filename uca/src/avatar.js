// The person behind the Apple menu, worked out the way the 1ovr1 appshell fills its bar avatar:
// a picture (profile_picture_url | avatar_url | avatar) covers the circle; without one, the first
// two letters of the username, uppercased ("?" when there is nobody); a signed-in user gets a
// ring and a green dot; a `profile:avatar {url}` message swaps the picture live.
// Identity: the user the shell signs in (app:context / auth:user) over componentProps.user.
import { need, emit, on, html, cn } from "./core.js";

let shellUser = null; // set while the host shell reports a signed-in user
let pictureOverride = null; // from profile:avatar
const failed = new Set(); // picture URLs that did not load: fall back to initials

const str = (v) => (v == null ? "" : String(v).trim());

// Same normalisation as the appshell's _userWithDefaults (snake_case from the shell, camelCase in props).
function normalise(u) {
  const username = str(u.username);
  const display = str(u.display_name ?? u.displayName) || username || (u.email ? str(u.email).split("@")[0] : "");
  const picture = str(u.profile_picture_url ?? u.avatar_url ?? u.avatarUrl ?? u.avatar);
  return { username, displayName: display, picture: picture || null };
}

export function identity() {
  const base = shellUser ? normalise(shellUser) : normalise(need("user"));
  const picture = pictureOverride ?? base.picture;
  return { ...base, picture, authed: Boolean(shellUser) };
}

export function initials({ username, displayName }) {
  if (username) return username.substring(0, 2).toUpperCase();
  const words = displayName.split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return "?";
}

// size: px. Markup only; the caller places it (the menu bar redraws it with the bar).
export function avatarHtml(size, extraClass) {
  const who = identity();
  const showPicture = who.picture && !failed.has(who.picture);
  const dot = Math.max(6, Math.round(size * 0.36));
  return html`<span data-avatar class="${cn(
    "relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-zinc-400 to-zinc-500 text-white select-none",
    who.authed ? "ring-1 ring-white/60 dark:ring-white/30" : "",
    extraClass,
  )}" style="width:${size}px;height:${size}px">
    ${
      showPicture
        ? html`<img data-avatar-img src="${who.picture}" alt="" draggable="false" decoding="async" width="${size}" height="${size}"
            class="h-full w-full rounded-full object-cover">`
        : html`<span aria-hidden="true" class="font-bold uppercase leading-none" style="font-size:${Math.max(8, Math.round(size * 0.42))}px">${initials(who)}</span>`
    }
    ${
      who.authed
        ? html`<span aria-hidden="true" data-avatar-dot class="absolute -bottom-px -right-px rounded-full bg-green-500 ring-[1.5px] ring-white dark:ring-zinc-900"
            style="width:${dot}px;height:${dot}px"></span>`
        : ""
    }
  </span>`;
}

// A picture that fails to load is remembered and the initials are shown instead.
export function pictureFailed(url) {
  if (!url || failed.has(url)) return;
  failed.add(url);
  emit("user:change", identity());
}

export function watchIdentity() {
  on("shell:context", (msg) => setShellUser(msg.user));
  on("shell:auth", (msg) => setShellUser(msg.authed === false ? null : msg.user));
  on("profile:avatar", (url) => {
    pictureOverride = url;
    failed.delete(url);
    emit("user:change", identity());
  });
}

function setShellUser(user) {
  const next = user && typeof user === "object" && (user.username || user.display_name || user.displayName) ? user : null;
  shellUser = next;
  if (!next) pictureOverride = null;
  emit("user:change", identity());
}
