// Renders a 16×16 grid of color swatches from a 256-color ACT palette.

export function render(container, bytes) {
  if (!bytes || bytes.length < 768) {
    container.replaceChildren(errorMsg("Invalid ACT file (expected 768 bytes)."));
    return;
  }

  // 6-bit VGA vs 8-bit detection (same logic as texture-decoder.js)
  let is8bit = false;
  for (let i = 0; i < 768; i++) {
    if (bytes[i] > 63) { is8bit = true; break; }
  }
  const palette = new Uint8Array(768);
  for (let i = 0; i < 768; i++) {
    palette[i] = is8bit ? bytes[i] : Math.round((bytes[i] * 255 + 31) / 63);
  }

  const CELL  = 24;
  const COLS  = 16;
  const ROWS  = 16;
  const W     = COLS * CELL;
  const H     = ROWS * CELL;
  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  canvas.className = "act-swatch";
  const ctx = canvas.getContext("2d");

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const idx = row * COLS + col;
      const r   = palette[idx * 3];
      const g   = palette[idx * 3 + 1];
      const b   = palette[idx * 3 + 2];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
    }
  }

  // Tooltip showing index + hex on hover
  const tooltip = document.createElement("div");
  tooltip.className = "act-tooltip";
  tooltip.hidden = true;
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const col  = Math.floor((e.clientX - rect.left) / CELL);
    const row  = Math.floor((e.clientY - rect.top)  / CELL);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) { tooltip.hidden = true; return; }
    const idx = row * COLS + col;
    const r   = palette[idx * 3];
    const g   = palette[idx * 3 + 1];
    const b   = palette[idx * 3 + 2];
    const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`.toUpperCase();
    tooltip.textContent = `Index ${idx}: ${hex}`;
    tooltip.hidden = false;
  });
  canvas.addEventListener("mouseleave", () => { tooltip.hidden = true; });

  const wrap = document.createElement("div");
  wrap.className = "act-wrap";
  wrap.appendChild(canvas);
  wrap.appendChild(tooltip);
  container.replaceChildren(wrap);
}

function errorMsg(text) {
  const p = document.createElement("p");
  p.className = "preview-error";
  p.textContent = text;
  return p;
}
