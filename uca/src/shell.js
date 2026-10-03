// App-shell integration (Record 50): gin: postMessage handshake and window.qcEmbed for thread embedding.
import { need, emit, on } from "./core.js";

const subscribers = new Set();
const pending = new Map();
let rid = 0;
let shellContext = null;
let embedState = { key: null, content: {}, sources: null };

export const isEmbedded = () => window.parent !== window;
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
    }
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
