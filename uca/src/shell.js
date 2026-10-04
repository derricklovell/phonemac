// App-shell integration (Record 50): gin: postMessage handshake and window.qcEmbed for thread embedding.
import { need, emit, on } from "./core.js";

const subscribers = new Set();
const pending = new Map();
let rid = 0;
let shellContext = null;
let embedState = { key: null, content: {}, sources: null };
// The session the host appshell gave this page in app:restore ({authed, user} — user may carry the
// platform auth_token). Held in memory only and handed to the records this page hosts, exactly as the
// appshell hands it to its own tabs; never written to storage or the page.
let session = { authed: false, user: null };

export const getSession = () => session;

export const isEmbedded = () => window.parent !== window;

// Pictures may come from the network, the page's own assets, or an uploaded data: image.
export const isPictureUrl = (url) => typeof url === "string" && url.length <= 4096 && /^(https?:\/\/|\/|data:image\/)/i.test(url);
export const getShellContext = () => shellContext;

export function boot() {
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== "object" || typeof msg.gin !== "string") return;
    if (e.source !== window.parent) return;
    if (msg.gin === "api:result" && pending.has(msg.rid)) {
      const { resolve } = pending.get(msg.rid);
      pending.delete(msg.rid);
      resolve(msg);
      return;
    }
    if (msg.gin === "app:context" || msg.gin === "shell:context") {
      shellContext = msg;
      emit("shell:context", msg);
      return;
    }
    if (msg.gin === "app:restore") {
      setSession(msg.authed, msg.user);
      return;
    }
    // The appshell tells its frames who signed in/out and when the profile picture changes.
    if (msg.gin === "auth:user") {
      emit("shell:auth", msg);
      // Signed out: drop the session now. Signed in: auth:user carries no token, so ask again —
      // the appshell answers a fresh app:ready with app:restore and the full user.
      if (msg.authed === false) setSession(false, null);
      else window.parent.postMessage({ gin: "app:ready", weight: need("shell.weight") }, "*");
      return;
    }
    // Things the appshell tells every app; the records this page hosts get them too.
    if (msg.gin === "app:event" || msg.gin === "shell:active") {
      emit("shell:relay", msg);
      return;
    }
    if (msg.gin === "profile:avatar" && isPictureUrl(msg.url)) emit("profile:avatar", msg.url);
  });
  if (isEmbedded()) window.parent.postMessage({ gin: "app:ready", weight: need("shell.weight") }, "*");

  // Thread embedding: the chat thread mounts/patches content keyed by entry.
  window.qcEmbed = {
    mount(spec) {
      embedState = { key: spec.key, content: { ...spec.content }, sources: spec.sources ?? null };
      emit("embed:mount", embedState);
      return embedState;
    },
    patch(spec) {
      embedState = {
        key: spec.key ?? embedState.key,
        content: { ...embedState.content, ...spec.content },
        sources: spec.sources ?? embedState.sources,
      };
      emit("embed:patch", embedState);
      return embedState;
    },
    on(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    get() {
      return embedState;
    },
  };

  // Desktop changes the thread may care about: route and window focus.
  on("route:changed", (route) => notify({ type: "route", key: embedState.key, detail: { route }, entry: null }));
}

function setSession(authed, user) {
  const next = { authed: Boolean(authed) && Boolean(user), user: authed && user && typeof user === "object" ? user : null };
  if (next.authed === session.authed && JSON.stringify(next.user) === JSON.stringify(session.user)) return;
  session = next;
  emit("shell:session", session);
}

// Requests from hosted records that only the appshell can answer (e.g. opening a record this page
// doesn't host). Standalone, there is nobody to ask.
export function toHost(msg) {
  if (isEmbedded()) window.parent.postMessage(msg, "*");
}

function notify(change) {
  subscribers.forEach((fn) => fn(change));
}

// Authenticated calls go through the shell, which adds its own JWT.
export function apiCall(endpoint, args) {
  if (!isEmbedded()) return Promise.reject(new Error("api:call needs the app shell"));
  const id = `pc-${++rid}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ gin: "api:call", rid: id, endpoint, args }, "*");
  });
}
