// Placeholder for apps not yet ported: a real window with controls and a labelled notice.
import { t, el, html, raw } from "../core.js";

export function createPendingApp(ctx, { app }) {
  const root = el(html`<div class="h-full flex flex-col bg-background text-foreground" data-app="${app.id}">
    <div data-window-drag-handle="true" class="px-4 py-2 flex items-center sticky top-0 z-[1] select-none bg-muted">
      <div class="shrink-0">${raw(ctx.controls("p-2"))}</div>
      <div class="flex-1 text-center text-sm font-semibold">${app.name}</div>
      <div class="shrink-0 w-[60px]"></div>
    </div>
    <div class="flex-1 flex items-center justify-center p-6">
      <p class="text-sm text-muted-foreground text-center max-w-sm">${t("pending.body", { app: app.name })}</p>
    </div>
  </div>`);
  root.firstElementChild.addEventListener("mousedown", (e) => ctx.startDrag(e));
  return { el: root };
}
