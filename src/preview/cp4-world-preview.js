/*
  Structured previews for Community Patch 4 world sidecars: .WTR lakes, MTM2 .VEG vegetation,
  beta 0.53 .WFL waterfalls and the 16-bit DATA\<track>.RAW heightmaps. Preview only; parsing is
  OpenPhotex's (src/vendor/openphotex: parseWtr, parseMtm2Veg, parseWfl, decodeMtm2Heights).
*/
import {
  parseWtr, parseMtm2Veg, vegTreeAt, parseWfl, wflPointsFt, decodeMtm2Heights,
  VEG_COLLIDE,
} from "../vendor/openphotex/index.js";
import { HEIGHTMAP_SCALES } from "../model/cp4-world.js";

const KIND = ["placed tree", "ground / grass"];
const SPEC_FLAGS = [[1, "cast shadow"], [2, "far shadow"], [4, "crossfade"], [8, "facing"]];
/** The retail world's side; a track format version 6 file can hold a 512-cell world (16,384 ft). */
const WORLD_FT = 8192;

let savedHeightScale = "cp4";

export function renderMwtr(container, bytes) {
  const wtr = parseWtr(bytes);
  const count = wtr.lakes.length;
  const summary = info(`MWTR ${wtr.major}.${wtr.minor} · ${wtr.tilesX}×${wtr.tilesZ} tiles · ${count} lake${count === 1 ? "" : "s"}`);

  const rows = wtr.lakes.map((k) => [
    k.id, k.heightFt.toFixed(1), k.reflective ? "yes" : "no", `0x${k.flags.toString(16)}`,
    k.seeds.length, k.tileCount, `${k.box.minX},${k.box.minZ} .. ${k.box.maxX},${k.box.maxZ}`,
  ]);
  const table = dataTable(["Lake", "Height (ft)", "Reflective", "Flags", "Seeds", "Tiles", "Tile bounds (x,z)"], rows);

  const parts = [summary, table];
  if (wtr.tileMap) {
    // N x N tiles: 256 in version 1, the world's N in version 2 (track format version 6).
    const { canvas, ctx, image } = blankCanvas(wtr.tilesX, wtr.tilesZ);
    for (let i = 0; i < wtr.tileMap.length; i++) {
      const id = wtr.tileMap[i];
      const [r, g, bl] = id === 0 ? [24, 24, 28] : bodyColour(id);
      image.data.set([r, g, bl, 255], i * 4);
    }
    ctx.putImageData(image, 0, 0);
    parts.push(heading("Tile map (x right, z down; dark tiles hold no water)"), canvas);
  } else {
    parts.push(info("No TMAP chunk."));
  }
  container.replaceChildren(...parts);
}

export function renderMveg(container, bytes) {
  const veg = parseMtm2Veg(bytes);
  const { trees, clumps } = veg;
  const summary = info(`MVEG ${veg.major}.${veg.minor} · ${veg.species.length} species · ${trees.count} trees`
    + ` · ${clumps.count} grass clumps in ${clumps.tiles.length} tiles`);

  const perSpecies = new Array(veg.species.length).fill(0);
  for (let i = 0; i < trees.count; i++) if (trees.species[i] < perSpecies.length) perSpecies[trees.species[i]]++;
  const rows = veg.species.map((s, i) => [
    i, s.name || "-", s.model, s.farModel || "-", KIND[s.kind] ?? `kind ${s.kind}`, VEG_COLLIDE[s.collide] ?? `collide ${s.collide}`,
    SPEC_FLAGS.filter(([bit]) => s.flags & bit).map(([, name]) => name).join(", ") || "-",
    (s.trunkDiameter / 64).toFixed(2), (s.trunkHeight / 16).toFixed(2), perSpecies[i],
  ]);
  const table = dataTable(["#", "Name", "Model", "Far model", "Kind", "Collide", "Flags", "Trunk dia (ft)", "Trunk ht (ft)", "Trees"], rows);

  // The world on a map of one pixel per 32 ft tile: 8192 ft on 256 px, or 16,384 ft on 512 px when
  // the file holds a tree or grass tile beyond 8192 ft (a track format version 6 world of 512 cells;
  // the .VEG header does not say). Grass tiles are tinted by clump density, trees drawn over them as dots.
  const wide = clumps.tiles.some((t) => t.tx >= 256 || t.tz >= 256)
    || Array.from({ length: trees.count }, (_, i) => vegTreeAt(trees, i)).some((t) => t.x >= WORLD_FT * 256 || t.z >= WORLD_FT * 256);
  const size = wide ? 512 : 256;
  const worldFt = WORLD_FT * (size / 256);
  const { canvas, ctx, image } = blankCanvas(size, size);
  for (let i = 0; i < size * size; i++) image.data.set([24, 24, 28, 255], i * 4);
  const maxClumps = clumps.tiles.reduce((m, t) => Math.max(m, t.count), 0) || 1;
  for (const t of clumps.tiles) {
    if (t.tx >= size || t.tz >= size) continue;
    const k = Math.sqrt(t.count / maxClumps);
    image.data.set([30, Math.round(60 + 140 * k), 40, 255], (t.tx + t.tz * size) * 4);
  }
  const feetPerPixel = worldFt / size;
  for (let i = 0; i < trees.count; i++) {
    const t = vegTreeAt(trees, i);
    const px = Math.floor(t.x / feetPerPixel);
    const pz = Math.floor(t.z / feetPerPixel);
    if (px < 0 || pz < 0 || px >= size || pz >= size) continue;
    image.data.set([240, 210, 90, 255], (px + pz * size) * 4);
  }
  ctx.putImageData(image, 0, 0);

  const parts = [summary, table, heading(`Top-down map, ${worldFt} ft square (x right, z down): green is grass density, yellow dots are trees`), canvas];
  const infoKeys = Object.entries(veg.info);
  if (infoKeys.length) parts.push(heading("INFO"), textBlock(infoKeys.map(([k, v]) => `${k}=${v}`).join("\n")));
  if (veg.rule !== null) parts.push(heading("RULE"), textBlock(veg.rule));
  container.replaceChildren(...parts);
}

/** Beta 0.53 waterfalls: header, one row a fall, and the crest lines on the wrapping world square. */
export function renderMwfl(container, bytes) {
  const wfl = parseWfl(bytes);
  // Version 2 (track format version 6) holds the world's N in its header: 8192 or 16,384 ft.
  const worldFt = 32 * wfl.cells;
  const n = wfl.falls.length;
  const summary = info(`MWFL ${wfl.major}.${wfl.minor} · stride ${wfl.stride} bytes · ${n} fall${n === 1 ? "" : "s"}`
    + ` · ${wfl.cells}×${wfl.cells} cells` + (wfl.minor >= 1 ? " · records carry the mist size" : ""));

  const flagNames = (f) => [f.freeze && "freeze", f.splash && "splash", f.sound && "sound"].filter(Boolean).join(", ") || "-";
  const rows = wfl.falls.map((f, i) => [
    i + 1, f.source === 0 ? "Spring" : `Lake ${f.source}`, f.heightFt.toFixed(1), f.points.length,
    crestWidthFt(f, worldFt).toFixed(1), f.speedFtPerSec.toFixed(2), f.opacity, f.mist, f.mistDepth, f.mistHeight, f.volume,
    flagNames(f), f.soundName || "-", f.textureName || "(default)",
  ]);
  const table = dataTable([
    "Fall", "Source", "Height (ft)", "Points", "Crest width (ft)", "Speed (ft/s)", "Opacity %", "Mist %",
    "Mist depth %", "Mist height %", "Volume %", "Flags", "Sound", "Texture",
  ], rows);

  // 512 px for the world square (16 ft a pixel, 32 on a 512-cell world): a crest is often under 100 ft
  // wide. Each segment takes the shortest way across the world edge, and the line is drawn again one
  // world over on each side so a crest that straddles the edge shows on both.
  const size = 512;
  const scale = size / worldFt;
  const { canvas, ctx } = blankCanvas(size, size);
  ctx.fillStyle = "rgb(24, 24, 28)";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let g = 1024; g < worldFt; g += 1024) {
    const p = g * scale + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  wfl.falls.forEach((f, i) => {
    const pts = unrolledCrest(f, worldFt);
    const [r, g, b] = bodyColour(i + 1);
    for (const dx of [-worldFt, 0, worldFt]) {
      for (const dz of [-worldFt, 0, worldFt]) {
        const at = ([x, z]) => [(x + dx) * scale, (z + dz) * scale];
        ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        pts.forEach((p, k) => { const [x, z] = at(p); if (k === 0) ctx.moveTo(x, z); else ctx.lineTo(x, z); });
        ctx.stroke();
        const [x0, z0] = at(pts[0]);
        ctx.beginPath(); ctx.arc(x0, z0, 3, 0, Math.PI * 2); ctx.fill();
        ctx.font = "11px sans-serif";
        ctx.fillText(String(i + 1), x0 + 5, z0 - 5);
      }
    }
  });

  container.replaceChildren(
    summary, table,
    heading(`Crest lines, ${worldFt} ft square (x right, z down; the dot and number mark point 1; grid every 1024 ft)`), canvas,
  );
}

/** Crest points in feet, each one the nearest copy (across the world's wrap) of the one before. */
function unrolledCrest(fall, worldFt) {
  const pts = wflPointsFt(fall);
  for (let k = 1; k < pts.length; k++) {
    pts[k] = [pts[k - 1][0] + wrapDelta(pts[k][0] - pts[k - 1][0], worldFt), pts[k - 1][1] + wrapDelta(pts[k][1] - pts[k - 1][1], worldFt)];
  }
  return pts;
}

function crestWidthFt(fall, worldFt) {
  const pts = unrolledCrest(fall, worldFt);
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  return len;
}

function wrapDelta(d, worldFt) {
  return d - worldFt * Math.round(d / worldFt);
}

/** Greyscale view of a 16-bit DATA heightmap, with the feet scale chosen from `layout`. */
export function renderHeightmap(container, bytes, layout) {
  const { side, gridFeet, interpretations } = layout;
  const heights = decodeMtm2Heights(bytes);
  const values = heights.fine ?? heights.coarse;
  let min = 65535;
  let max = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

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
