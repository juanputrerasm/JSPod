/*
  Text entries: a read-only view with an Edit button. Editing happens in a textarea; Apply
  writes the text back into the archive as windows-1252 (OpenPhotex encodeWindows1252, the exact
  inverse of how it was read), as one undoable edit. Characters the 8-bit text cannot store are
  refused with their position.
*/
import { encodeWindows1252 } from "../vendor/openphotex/index.js";

const decoder = new TextDecoder("latin1");

export function render(container, bytes, context = {}) {
  const original = decoder.decode(bytes);
  const crlf = original.includes("\r\n");
  const pre = document.createElement("pre");
  pre.className = "text-preview";
  pre.textContent = original;
  if (!context.editText || !context.entry) {
    container.replaceChildren(pre);
    return;
  }

  const bar = document.createElement("div");
  bar.className = "raw-controls text-toolbar";
  const edit = button("Edit");
  const apply = button("Apply", "btn-primary");
  const revert = button("Revert");
  const status = document.createElement("span");
  status.className = "preview-info";
  status.textContent = `${bytes.length.toLocaleString()} bytes${crlf ? " · CRLF" : ""}`;
  apply.hidden = revert.hidden = true;
  bar.append(edit, apply, revert, status);

  const area = document.createElement("textarea");
  area.className = "text-editor";
  area.spellcheck = false;
  area.hidden = true;
  container.replaceChildren(bar, pre, area);

  const setEditing = (on) => {
    pre.hidden = on;
    area.hidden = !on;
    edit.hidden = on;
    apply.hidden = revert.hidden = !on;
    if (on) { area.value = original.replace(/\r\n/g, "\n"); area.focus(); }
  };
  const modified = () => area.value !== original.replace(/\r\n/g, "\n");
  area.addEventListener("input", () => {
    status.textContent = modified() ? "modified" : "unchanged";
  });
  area.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); apply.click(); }
    if (e.key === "Escape") { e.preventDefault(); revert.click(); }
    if (e.key === "Tab") {
      e.preventDefault();
      area.setRangeText("\t", area.selectionStart, area.selectionEnd, "end");
    }
  });
  edit.addEventListener("click", () => setEditing(true));
  revert.addEventListener("click", () => { setEditing(false); status.textContent = `${bytes.length.toLocaleString()} bytes${crlf ? " · CRLF" : ""}`; });
  apply.addEventListener("click", async () => {
    if (!modified()) { setEditing(false); return; }
    // Keep the entry's own line ends: Terminal Reality text files are CRLF.
    const text = crlf ? area.value.replace(/\n/g, "\r\n") : area.value;
    const encoded = encodeWindows1252(text);
    if (typeof encoded === "number") {
      const line = text.slice(0, encoded).split("\n").length;
      status.textContent = `Line ${line}: "${text[encoded]}" cannot be stored in this file's 8-bit text.`;
      status.classList.add("preview-error");
      return;
    }
    await context.editText(context.entry, encoded);
  });
}

function button(label, extra = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn btn-small ${extra}`;
  b.textContent = label;
  return b;
}
