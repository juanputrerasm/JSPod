import { showModal } from "../ui/modal.js";
import { detectDimensions, suggestDimensions } from "../worker/texture-decoder.js";
import { normalizeArchiveName, basenameWithoutExtension } from "../shared/path-utils.js";
import { PALETTES } from "../shared/bundled-palettes.js";

let _savedPaletteLabel = null;

export async function render(container, bytes, { entry, podIndex, workerClient, opfsPodPath }) {
  const autoDims      = detectDimensions(bytes.length);
  const paletteOptions = buildPaletteOptions(entry, podIndex);
  const savedIndex     = paletteOptions.findIndex((option) => option.label === _savedPaletteLabel);
  const initIndex      = savedIndex >= 0 ? savedIndex : 0;

  let dims = autoDims;

  if (!dims) {
    // Non-standard size: show dimension + palette picker modal first
    const result = await showDimensionPickerModal(bytes.length, paletteOptions);
    if (!result) { container.replaceChildren(errorMsg("Preview cancelled.")); return; }
    dims = result.dims;
  }

  // Build controls: palette selector + download button
  const controls = document.createElement("div");
  controls.className = "raw-controls";

  const palLabel = document.createElement("label");
  palLabel.className = "raw-ctrl-label";
  palLabel.textContent = "Palette: ";
  const palSelect = document.createElement("select");
  palSelect.className = "raw-palette-select";
  for (let i = 0; i < paletteOptions.length; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = paletteOptions[i].label;
    palSelect.appendChild(opt);
  }
  palSelect.value = String(initIndex);
  palLabel.appendChild(palSelect);

  const dlBtn = document.createElement("button");
  dlBtn.className = "btn btn-small";
  dlBtn.textContent = "⬇ Save as BMP";

  controls.appendChild(palLabel);
  controls.appendChild(dlBtn);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "raw-wrap";

  container.replaceChildren(controls, canvasWrap);

  let currentCanvas = null;
  let currentPalette = null;

  async function repaint(paletteIdx) {
    const option  = paletteOptions[paletteIdx ?? 0] ?? null;
    currentPalette = await resolvePalette(option, paletteOptions, workerClient, opfsPodPath);
    currentCanvas  = drawRaw(canvasWrap, bytes, dims[0], dims[1], currentPalette);
  }

  palSelect.addEventListener("change", () => {
    const selectedIndex = parseInt(palSelect.value, 10);
    _savedPaletteLabel = paletteOptions[selectedIndex]?.label ?? null;
    repaint(selectedIndex);
  });

  dlBtn.addEventListener("click", () => {
    if (!currentCanvas) return;
    const bmpBytes = encodeBmp(dims[0], dims[1], currentPalette, bytes);
    const base = basenameWithoutExtension(entry.title);
    triggerDownload(bmpBytes, `${base}.bmp`);
  });

  await repaint(initIndex);
}

// ─── Dimension picker modal (non-standard sizes) ──────────────────────────────
async function showDimensionPickerModal(byteCount, paletteOptions) {
  const suggestions = suggestDimensions(byteCount);
  const body = document.createDocumentFragment();

  const dimLabel = document.createElement("label");
  dimLabel.textContent = "Dimensions:";
  dimLabel.className = "modal-field-label";
  body.appendChild(dimLabel);

  const dimRow = document.createElement("div");
  dimRow.className = "modal-row";
  const wInput = document.createElement("input");
  wInput.type = "number"; wInput.min = "1"; wInput.max = "4096";
  wInput.value = String(suggestions[0]?.w ?? 64);
  wInput.className = "modal-input dim-input";
  const xSpan = document.createElement("span");
  xSpan.textContent = " × ";
  const hInput = document.createElement("input");
  hInput.type = "number"; hInput.min = "1"; hInput.max = "4096";
  hInput.value = String(suggestions[0]?.h ?? 64);
  hInput.className = "modal-input dim-input";
  dimRow.appendChild(wInput); dimRow.appendChild(xSpan); dimRow.appendChild(hInput);
  body.appendChild(dimRow);

  if (suggestions.length > 0) {
    const hint = document.createElement("p");
    hint.className = "modal-hint";
    hint.textContent = `Suggested (${byteCount} bytes):`;
    body.appendChild(hint);
    const sugWrap = document.createElement("div");
    sugWrap.className = "dim-suggestions";
    for (const s of suggestions.slice(0, 10)) {
      const btn = document.createElement("button");
      btn.className = "btn btn-small";
      btn.textContent = `${s.w}×${s.h}`;
      btn.addEventListener("click", () => { wInput.value = String(s.w); hInput.value = String(s.h); });
      sugWrap.appendChild(btn);
    }
    body.appendChild(sugWrap);
  }

  return showModal({
    title: "RAW Image Dimensions",
    body,
    onOk: () => ({
      dims: [parseInt(wInput.value, 10) || 64, parseInt(hInput.value, 10) || 64]
    })
  });
}

// ─── Palette resolution chain ─────────────────────────────────────────────────
function buildPaletteOptions(entry, podIndex) {
  const options   = [];
  const baseName  = basenameWithoutExtension(entry.title);
  const dirPrefix = normalizeArchiveName(entry.name).replace(/\/[^/]+$/, "");

  const sameAct = podIndex.entries.find((e) => e.title.toUpperCase() === `${baseName}.ACT`);
  if (sameAct) options.push({ label: `${sameAct.title} (same name)`, entry: sameAct });

  const metadataName = entry.paletteName?.trim();
  let metadataEntry = null;
  if (metadataName?.toUpperCase().endsWith(".ACT")) {
    const upperMetadataName = metadataName.toUpperCase();
    metadataEntry = podIndex.entries.find((candidate) => candidate.title.toUpperCase() === upperMetadataName) ?? null;
    const metadataOption = { label: `${metadataName} (POD metadata)` };
    if (metadataEntry) {
      metadataOption.entry = metadataEntry;
    } else if (upperMetadataName === "METALCR2.ACT") {
      metadataOption.bytes = PALETTES.metalcr2Mtm1;
    } else {
      metadataOption.unresolved = true;
      metadataOption.label += " — not in archive";
    }
    options.push(metadataOption);
  }

  options.push({ label: "METALCR2 (MTM1)",  bytes: PALETTES.metalcr2Mtm1 });
  options.push({ label: "METALCR2 (CPR)",   bytes: PALETTES.metalcr2Cpr });
  options.push({ label: "VGA (Hellbender)", bytes: PALETTES.vgaHB });
  options.push({ label: "VGA (TV/F3)",      bytes: PALETTES.vgaTV });
  options.push({ label: "Greyscale",        greyscale: true });

  for (const e of podIndex.entries) {
    if (!e.title.toUpperCase().endsWith(".ACT")) continue;
    const eDir = e.normalizedName.replace(/\/[^/]+$/, "");
    if (eDir === dirPrefix && e !== sameAct && e !== metadataEntry) {
      options.push({ label: `${e.title} (same folder)`, entry: e });
    }
  }

  return options;
}

async function resolvePalette(option, defaultOptions, workerClient, opfsPodPath) {
  const opt = option ?? defaultOptions[0];
  if (!opt || opt.greyscale || opt.unresolved) return makeGreyscalePalette();
  if (opt.bytes) return normalizeAct(opt.bytes);
  try {
    const { bytes } = await workerClient.call("readEntryBytes", { opfsPodPath, entry: opt.entry });
    return normalizeAct(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    return normalizeAct(PALETTES.metalcr2Mtm1);
  }
}

function normalizeAct(actBytes) {
  if (!actBytes || actBytes.length < 768) return makeGreyscalePalette();
  const raw = actBytes.subarray(0, 768);
  let is8bit = false;
  for (let i = 0; i < 768; i++) { if (raw[i] > 63) { is8bit = true; break; } }
  if (is8bit) return raw.slice();
  const out = new Uint8Array(768);
  for (let i = 0; i < 768; i++) out[i] = Math.round((raw[i] * 255 + 31) / 63);
  return out;
}

function makeGreyscalePalette() {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) p[i * 3] = p[i * 3 + 1] = p[i * 3 + 2] = i;
  return p;
}

// ─── Canvas rendering ─────────────────────────────────────────────────────────
function drawRaw(container, bytes, w, h, palette) {
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = w; tmpCanvas.height = h;
  const ctx  = tmpCanvas.getContext("2d");
  const data = ctx.createImageData(w, h);
  const pixels = Math.min(bytes.length, w * h);
  for (let i = 0; i < pixels; i++) {
    const ci = bytes[i] * 3;
    const o  = i * 4;
    data.data[o]     = palette[ci];
    data.data[o + 1] = palette[ci + 1];
    data.data[o + 2] = palette[ci + 2];
    data.data[o + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);

  const scale  = w <= 64 ? 4 : 1;
  const canvas = document.createElement("canvas");
  canvas.width  = w * scale; canvas.height = h * scale;
  const outCtx  = canvas.getContext("2d");
  outCtx.imageSmoothingEnabled = false;
  outCtx.drawImage(tmpCanvas, 0, 0, w * scale, h * scale);
  canvas.className = "raw-canvas";

  const info = document.createElement("p");
  info.className = "preview-info";
  info.textContent = `${w} × ${h} px  ·  ${bytes.length} bytes`;

  container.replaceChildren(canvas, info);
  return canvas;
}

// ─── BMP encoder ──────────────────────────────────────────────────────────────
function encodeBmp(w, h, palette, rawBytes) {
  const rowStride = Math.ceil(w * 3 / 4) * 4; // pad rows to 4 bytes
  const pixelDataSize = rowStride * h;
  const fileSize = 54 + pixelDataSize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  const u8   = new Uint8Array(buf);

  // File header (14 bytes)
  u8[0] = 0x42; u8[1] = 0x4d;           // "BM"
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);            // reserved
  view.setUint32(10, 54, true);          // pixel data offset

  // DIB header — BITMAPINFOHEADER (40 bytes)
  view.setUint32(14, 40, true);          // header size
  view.setInt32(18, w, true);
  view.setInt32(22, h, true);            // positive = bottom-to-top
  view.setUint16(26, 1, true);           // color planes
  view.setUint16(28, 24, true);          // bits per pixel
  view.setUint32(30, 0, true);           // compression (none)
  view.setUint32(34, pixelDataSize, true);
  view.setUint32(38, 0, true);           // x px/meter
  view.setUint32(42, 0, true);           // y px/meter
  view.setUint32(46, 0, true);           // colors in table
  view.setUint32(50, 0, true);           // important colors

  // Pixel data: BMP is bottom-to-top, BGR order
  const pixels = Math.min(rawBytes.length, w * h);
  for (let row = 0; row < h; row++) {
    const bmpRow = h - 1 - row;          // flip Y
    const bmpBase = 54 + bmpRow * rowStride;
    for (let col = 0; col < w; col++) {
      const idx = rawBytes[row * w + col] ?? 0;
      const ci  = idx * 3;
      const b   = bmpBase + col * 3;
      u8[b]     = palette[ci + 2];       // B
      u8[b + 1] = palette[ci + 1];       // G
      u8[b + 2] = palette[ci];           // R
    }
  }
  return new Uint8Array(buf);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function triggerDownload(bytes, filename) {
  const blob = new Blob([bytes], { type: "image/bmp" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function errorMsg(text) {
  const p = document.createElement("p");
  p.className = "preview-error";
  p.textContent = text;
  return p;
}
