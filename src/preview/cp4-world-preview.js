/*
  Structured previews for Community Patch 4 world sidecars: MWTR lakes (.WTR), MVEG
  vegetation (.VEG) and the 16-bit DATA\<track>.RAW heightmaps. Preview only; the
  parsers live in model/cp4-world.js.
*/
import { parseMwtr, parseMveg, readHeightSamples, HEIGHTMAP_SCALES } from "../model/cp4-world.js";

const KIND = ["placed tree", "ground / grass"];
const COLLIDE = ["none", "trunk", "model"];
const SPEC_FLAGS = [[1, "cast shadow"], [2, "far shadow"], [4, "crossfade"], [8, "facing"]];

let savedHeightScale = "cp4";

export function renderMwtr(container, bytes) {
  const lakes = parseMwtr(bytes);
  const { header } = lakes;
  const summary = info(`MWTR ${header.major}.${header.minor} · ${header.tilesX}×${header.tilesZ} tiles · ${lakes.bodies.length} water bod${lakes.bodies.length === 1 ? "y" : "ies"}`
    + (lakes.declaredBodies > lakes.bodies.length ? ` (${lakes.declaredBodies} declared, rest truncated)` : ""));

  const rows = lakes.bodies.map((b) => [
    b.id, b.heightFeet.toFixed(1), b.reflective ? "yes" : "no", `0x${b.flags.toString(16)}`,
    b.seeds.length, b.tileCount, `${b.bounds.minX},${b.bounds.minZ} .. ${b.bounds.maxX},${b.bounds.maxZ}`,
  ]);
  const table = dataTable(["Body", "Height (ft)", "Reflective", "Flags", "Seeds", "Tiles", "Tile bounds (x,z)"], rows);

  const parts = [summary, table];
  if (lakes.tmap) {
    const { canvas, ctx, image } = blankCanvas(header.tilesX, header.tilesZ);
    for (let i = 0; i < lakes.tmap.length; i++) {
      const id = lakes.tmap[i];
      const [r, g, bl] = id === 0 ? [24, 24, 28] : bodyColour(id);
      image.data.set([r, g, bl, 255], i * 4);
    }
    ctx.putImageData(image, 0, 0);
    parts.push(heading("Tile map (x right, z down; dark tiles hold no water)"), canvas);
  } else {
    parts.push(info("No TMAP chunk."));
  }
  parts.push(chunkList(lakes.chunks));
  container.replaceChildren(...parts);
}

export function renderMveg(container, bytes) {
  const veg = parseMveg(bytes);
  const { header } = veg;
  const summary = info(`MVEG ${header.major}.${header.minor} · ${header.tilesX}×${header.tilesZ} tiles · flags 0x${(header.flags ?? 0).toString(16)}`
    + ` · ${veg.species.length} species · ${veg.trees.length} trees`
    + (veg.declaredTrees > veg.trees.length ? ` (${veg.declaredTrees} declared, rest truncated)` : "")
    + ` · ${veg.clumps} grass clumps in ${veg.grassTiles.length} tiles`);

  const rows = veg.species.map((s, i) => [
    i, s.model, s.farModel || "-", KIND[s.kind] ?? `kind ${s.kind}`, COLLIDE[s.collide] ?? `collide ${s.collide}`,
    SPEC_FLAGS.filter(([bit]) => s.flags & bit).map(([, name]) => name).join(", ") || "-",
    s.trunkDiameterFeet.toFixed(2), s.trunkHeightFeet.toFixed(2), s.count,
  ]);
  const table = dataTable(["#", "Model", "Far model", "Kind", "Collide", "Flags", "Trunk dia (ft)", "Trunk ht (ft)", "Trees"], rows);

  // 8192 ft world on a 256 px map: one pixel per 32 ft tile. Grass tiles are tinted by
  // clump density, trees drawn over them as dots.
  const size = 256;
  const { canvas, ctx, image } = blankCanvas(size, size);
  for (let i = 0; i < size * size; i++) image.data.set([24, 24, 28, 255], i * 4);
  const maxClumps = veg.grassTiles.reduce((m, t) => Math.max(m, t.count), 0) || 1;
  for (const t of veg.grassTiles) {
    if (t.tx >= size || t.tz >= size) continue;
    const k = Math.sqrt(t.count / maxClumps);
    image.data.set([30, Math.round(60 + 140 * k), 40, 255], (t.tx + t.tz * size) * 4);
  }
  const feetPerPixel = 8192 / size;
  for (const t of veg.trees) {
    const px = Math.floor(t.x / feetPerPixel);
    const pz = Math.floor(t.z / feetPerPixel);
    if (px < 0 || pz < 0 || px >= size || pz >= size) continue;
    image.data.set([240, 210, 90, 255], (px + pz * size) * 4);
  }
  ctx.putImageData(image, 0, 0);

  const parts = [summary, table, heading("Top-down map, 8192 ft square (x right, z down): green is grass density, yellow dots are trees"), canvas];
  if (veg.info !== null) parts.push(heading("INFO"), textBlock(veg.info));
  if (veg.rule !== null) parts.push(heading("RULE"), textBlock(veg.rule));
  parts.push(chunkList(veg.chunks));
  container.replaceChildren(...parts);
}

/** Greyscale view of a 16-bit DATA heightmap, with the feet scale chosen from `layout`. */
export function renderHeightmap(container, bytes, layout) {
  const { side, gridFeet, interpretations } = layout;
  const { values, min, max } = readHeightSamples(bytes, side);

  const controls = document.createElement("div");
  controls.className = "raw-controls";
  const label = document.createElement("label");
  label.className = "raw-ctrl-label";
  label.textContent = "Units: ";
  const select = document.createElement("select");
  select.className = "raw-palette-select";
  for (const key of interpretations) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = HEIGHTMAP_SCALES[key].label;
    select.appendChild(opt);
  }
  select.value = interpretations.includes(savedHeightScale) ? savedHeightScale : interpretations[0];
  label.appendChild(select);
  controls.appendChild(label);

  const { canvas, ctx, image } = blankCanvas(side, side);
  const range = Math.max(1, max - min);
  for (let i = 0; i < values.length; i++) {
    const g = Math.round(((values[i] - min) / range) * 255);
    image.data.set([g, g, g, 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);

  const readout = info("");
  const update = () => {
    savedHeightScale = select.value;
    const { divisor } = HEIGHTMAP_SCALES[select.value];
    const grid = select.value === "cp4" ? ` · ${gridFeet} ft grid` : "";
    readout.textContent = `${side} × ${side} u16 LE${grid} · min ${(min / divisor).toFixed(2)} ft · max ${(max / divisor).toFixed(2)} ft`
      + (interpretations.length > 1 ? " · this size is a CP4 heightmap or a CPR one; pick the units" : "");
  };
  select.addEventListener("change", update);
  update();

  const wrap = document.createElement("div");
  wrap.className = "raw-wrap";
  wrap.append(canvas, readout);
  container.replaceChildren(controls, wrap);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bodyColour(id) {
  // Golden-angle hues keep neighbouring ids apart.
  const hue = (id * 137.508) % 360;
  return hslToRgb(hue / 360, 0.65, 0.55);
}

function hslToRgb(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255));
}

function blankCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.className = "raw-canvas";
  canvas.width = width;
  canvas.height = height;
  if (width <= 256) canvas.style.width = `${width * 2}px`;
  const ctx = canvas.getContext("2d");
  return { canvas, ctx, image: ctx.createImageData(width, height) };
}

function info(text) {
  const p = document.createElement("p");
  p.className = "preview-info";
  p.textContent = text;
  return p;
}

function heading(text) {
  const h = document.createElement("p");
  h.className = "report-heading";
  h.textContent = text;
  return h;
}

function textBlock(text) {
  const pre = document.createElement("pre");
  pre.className = "text-preview";
  pre.textContent = text;
  return pre;
}

function dataTable(columns, rows) {
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const c of columns) {
    const td = document.createElement("td");
    td.textContent = c;
    headRow.appendChild(td);
  }
  head.appendChild(headRow);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = String(cell);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  table.append(head, body);
  scroll.appendChild(table);
  return scroll;
}

function chunkList(chunks) {
  return info("Chunks: " + chunks.map((c) => `${c.id} v${c.version} @${c.offset} (${c.size} B)`).join(" · "));
}
