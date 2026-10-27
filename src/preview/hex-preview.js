/* Hex dump, 16 bytes a line, a page of 4 KB at a time. */
const BYTES_PER_ROW = 16;
const PAGE = 4096;

export function render(container, bytes) {
  const pages = Math.max(1, Math.ceil(bytes.length / PAGE));
  const pre = document.createElement("pre");
  pre.className = "hex-dump";
  const bar = document.createElement("div");
  bar.className = "raw-controls";
  const prev = Object.assign(document.createElement("button"), { className: "btn btn-small", textContent: "◀" });
  const next = Object.assign(document.createElement("button"), { className: "btn btn-small", textContent: "▶" });
  const label = document.createElement("span");
  label.className = "preview-info";
  const jump = Object.assign(document.createElement("input"), { type: "text", className: "modal-input hex-jump", placeholder: "offset (hex)" });
  bar.append(prev, label, next, jump);
  let page = 0;
  const show = () => {
    const start = page * PAGE;
    const end = Math.min(bytes.length, start + PAGE);
    const lines = [];
    for (let i = start; i < end; i += BYTES_PER_ROW) {
      const row = bytes.subarray(i, Math.min(end, i + BYTES_PER_ROW));
      const addr = i.toString(16).padStart(8, "0");
      const hex = [...row].map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(BYTES_PER_ROW * 3 - 1, " ");
      const ascii = [...row].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
      lines.push(`${addr}  ${hex}  ${ascii}`);
    }
    pre.textContent = lines.join("\n");
    label.textContent = `${start.toString(16)}-${Math.max(start, end - 1).toString(16)} of ${bytes.length.toLocaleString()} bytes`;
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
  };
  prev.addEventListener("click", () => { page--; show(); });
  next.addEventListener("click", () => { page++; show(); });
  jump.addEventListener("change", () => {
    const offset = Number.parseInt(jump.value.replace(/^0x/i, ""), 16);
    if (Number.isFinite(offset) && offset >= 0 && offset < bytes.length) { page = Math.floor(offset / PAGE); show(); }
  });
  show();
  container.replaceChildren(...(pages > 1 ? [bar, pre] : [pre]));
}
