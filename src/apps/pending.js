// Placeholder for apps not yet ported: a real window with controls and a labelled notice.
// On the phone there is no window, so the header is a plain title (no traffic lights).
import { t, el, html, raw, cn } from "../core.js";

export function createPendingApp(ctx, { app, mobile }) {
  const root = el(html`<div class="h-full flex flex-col bg-background text-foreground" data-app="${app.id}">
    <div ${raw(mobile ? "" : 'data-window-drag-handle="true"')} class="${cn("px-4 py-2 flex items-center sticky top-0 z-[1] select-none bg-muted", mobile && "min-h-11")}">
      ${mobile ? "" : html`<div class="shrink-0">${raw(ctx.controls("p-2"))}</div>`}
      <div class="flex-1 text-center text-sm font-semibold">${app.name}</div>
      ${mobile ? "" : raw('<div class="shrink-0 w-[60px]"></div>')}
    </div>
    <div class="flex-1 flex items-center justify-center p-6">
      <p class="text-sm text-muted-foreground text-center max-w-sm">${t("pending.body", { app: app.name })}</p>
    </div>
  </div>`);
  if (!mobile) root.firstElementChild.addEventListener("mousedown", (e) => ctx.startDrag(e));
  return { el: root };
}
