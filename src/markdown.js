// GitHub-flavoured Markdown rendering for Notes (markdown-it is inlined as a vendor script).
/* global markdownit */
import { esc } from "./core.js";

let md = null;

function engine() {
  if (!md) md = markdownit({ html: true, linkify: true, breaks: false });
  return md;
}

const TASK = /^\[([ xX])\]\s/;

export function renderMarkdown(source, { editable }) {
  const tpl = document.createElement("template");
  tpl.innerHTML = `<div class="markdown-body">${engine().render(source)}</div>`;
  const body = tpl.content.firstElementChild;

  // Task list items, matching remark-gfm + the original renderer's markup (whose ids end in -0).
  body.querySelectorAll("li").forEach((li) => {
    const first = li.firstChild?.nodeType === Node.ELEMENT_NODE && li.firstChild.tagName === "P" ? li.firstChild : li;
    const textNode = first.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE || !TASK.test(textNode.textContent)) return;
    const checked = textNode.textContent[1].toLowerCase() === "x";
    textNode.textContent = textNode.textContent.replace(TASK, "");
    const label = document.createElement("span");
    label.append(" ", ...first.childNodes);
    const taskText = label.textContent.trim();
    const id = `task-${taskText.substring(0, 20).replace(/\s+/g, "-").toLowerCase()}-0`;
    li.className = "task-list-item";
    li.closest("ul")?.classList.add("contains-task-list");
    li.innerHTML = `<span class="flex items-start"><span class="${editable ? "cursor-pointer" : "cursor-default"} mr-1" data-task="${esc(taskText)}" data-checked="${checked}"><input class="pointer-events-none" id="${esc(id)}" readonly type="checkbox"${checked ? " checked" : ""}></span></span>`;
    li.firstElementChild.appendChild(label);
  });

  body.querySelectorAll("a[href]").forEach((a) => {
    if (/^https?:\/\//i.test(a.getAttribute("href"))) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  });

  body.querySelectorAll("img").forEach((img) => {
    img.className = "w-full max-w-xl h-auto object-contain";
    img.width = 1200;
    img.height = 800;
    if (!img.alt) img.alt = "image";
  });

  return body.outerHTML;
}
