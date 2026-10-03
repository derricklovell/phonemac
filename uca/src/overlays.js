// System overlays: sleep, lock screen, restart, shut down, log out.
import { need, t, el, html, icon, asset, on } from "./core.js";
import { settings } from "./settings-store.js";

let host;

export function mount(container, { onReset }) {
  host = container;
  on("system:overlay", (kind) => show(kind, onReset));
}

function wallpaperSrc() {
  const s = settings();
  return s.wallpaperUrl ?? need(`desktop.wallpapers.${s.osVersion}`).src;
}

function bootSequence(onDone) {
  const node = el(html`<div class="flex flex-col items-center gap-8">
    ${icon("apple", "w-20 h-20 text-white/80")}
    <div class="w-48 h-1.5 bg-white/20 rounded-full overflow-hidden"><div class="h-full bg-white/80 rounded-full transition-all duration-150" style="width:0%"></div></div>
  </div>`);
  const bar = node.querySelector("div > div");
  const { stepMs, stepPercent, finishDelayMs } = need("desktop.boot");
  let progress = 0;
  const timer = setInterval(() => {
    progress = Math.min(100, progress + stepPercent);
    bar.style.width = `${progress}%`;
    if (progress >= 100) {
      clearInterval(timer);
      setTimeout(onDone, finishDelayMs);
    }
  }, stepMs);
  return node;
}

function lockTime() {
  const now = new Date();
  const locale = need("formats.locale");
  const time = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`;
  const date = `${now.toLocaleDateString(locale, { weekday: "short" })} ${now.toLocaleDateString(locale, { month: "short" })} ${now.getDate()}`;
  return { time, date };
}

function show(kind, onReset) {
  let node;
  const close = (fade) => {
    if (fade) {
      node.classList.replace("opacity-100", "opacity-0");
      setTimeout(() => node.remove(), fade);
    } else node.remove();
  };

  if (kind === "sleep") {
    node = el(`<div class="fixed inset-0 z-[100] bg-black cursor-pointer transition-opacity duration-500 opacity-100" role="button" tabindex="0" aria-label="${t("overlay.wake")}"></div>`);
    node.addEventListener("click", () => close(500));
  } else if (kind === "lock") {
    const { time, date } = lockTime();
    node = el(html`<div class="fixed inset-0 z-[100] flex flex-col items-center transition-opacity duration-300 bg-black opacity-100" role="button" tabindex="0" aria-label="${t("overlay.unlock")}">
      <div class="absolute inset-0"><img alt="" src="${wallpaperSrc()}" class="absolute inset-0 h-full w-full object-cover"></div>
      <div class="mt-24 text-center relative z-10">
        <div class="text-2xl font-medium text-white/80 tracking-wide [text-shadow:0_0_20px_rgba(255,255,255,0.3),0_2px_4px_rgba(0,0,0,0.2)]" data-lock-date>${date}</div>
        <div class="text-[120px] font-medium text-white/70 leading-none tracking-tight [text-shadow:0_0_40px_rgba(255,255,255,0.4),0_0_80px_rgba(255,255,255,0.2),0_4px_8px_rgba(0,0,0,0.3)]" data-lock-time>${time}</div>
      </div>
      <div class="flex-1"></div>
      <div class="mb-16 flex flex-col items-center relative z-10">
        <div class="w-16 h-16 rounded-full overflow-hidden shadow-xl"><img src="${asset("avatar")}" alt="${need("user.displayName")}" width="64" height="64" class="object-cover w-full h-full"></div>
        <div class="mt-2 text-sm font-medium text-white drop-shadow-md">${need("user.displayName")}</div>
        <div class="mt-1 text-xs text-white/70 drop-shadow-sm">${t("overlay.touchId")}</div>
      </div>
    </div>`);
    const tick = setInterval(() => {
      const v = lockTime();
      node.querySelector("[data-lock-time]").textContent = v.time;
      node.querySelector("[data-lock-date]").textContent = v.date;
    }, 1000);
    node.addEventListener("click", () => {
      clearInterval(tick);
      close(300);
    });
  } else if (kind === "restart" || kind === "logout") {
    node = el(`<div class="fixed inset-0 z-[100] bg-black flex items-center justify-center"></div>`);
    node.appendChild(
      bootSequence(() => {
        onReset();
        close(0);
      }),
    );
  } else if (kind === "shutdown") {
    node = el(`<div class="fixed inset-0 z-[100] bg-black flex items-center justify-center cursor-pointer" role="button" tabindex="0" aria-label="${t("overlay.powerOn")}"></div>`);
    node.addEventListener(
      "click",
      () =>
        node.appendChild(
          bootSequence(() => {
            onReset();
            close(0);
          }),
        ),
      { once: true },
    );
  } else return;

  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") node.click();
  });
  host.appendChild(node);
  node.focus();
}
