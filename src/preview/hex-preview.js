const BYTES_PER_ROW = 16;
const MAX_BYTES     = 4096;

export function render(container, bytes) {
  const limit = Math.min(bytes.length, MAX_BYTES);
  const lines = [];
  for (let i = 0; i < limit; i += BYTES_PER_ROW) {
    const row   = bytes.subarray(i, i + BYTES_PER_ROW);
    const addr  = i.toString(16).padStart(8, "0");
    const hex   = [...row].map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(BYTES_PER_ROW * 3 - 1, " ");
    const ascii = [...row].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${addr}  ${hex}  ${ascii}`);
  }
  if (bytes.length > MAX_BYTES) {
    lines.push(`\n… (${bytes.length - MAX_BYTES} more bytes not shown)`);
  }
  const pre = document.createElement("pre");
  pre.className = "hex-dump";
  pre.textContent = lines.join("\n");
  container.replaceChildren(pre);
}
