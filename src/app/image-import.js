/*
  Import Image as RAW: true-colour art (PNG, BMP, JPG, GIF, WebP, TGA) becomes an 8-bit .RAW.

  Two palette choices:
  - Own palette: OpenPhotex encodeRawTexture builds a 256-colour palette for the image and the
    import adds a same-name .ACT next to the .RAW, as 4x4 Evolution and MTM2 art carry them.
    Classic RAW art is square, so this needs a square image.
  - Existing palette: OpenPhotex quantizeToPalette maps the image onto an .ACT already in the
    archive (or a stock METALCR2/VGA), for archives whose textures share one palette.

  Transparent pixels (alpha under 128) take palette index 0, the colour key.
*/
import { decodeActPalette } from "../vendor/openphotex/index.js";
import { PALETTES } from "../shared/bundled-palettes.js";
import { openDialog, alertDialog } from "../ui/dialogs.js";
import { pickFiles } from "./disk.js";
import { addEntries } from "../model/edits.js";
import { entryKey, joinEntry, pathProblem } from "../model/paths.js";

const BUNDLED = [
  ["metalcr2Mtm1", "Stock METALCR2 (MTM1/MTM2)"],
  ["metalcr2Cpr", "Stock METALCR2 (CPR)"],
  ["vgaHB", "Stock VGA (Hellbender)"],
  ["vgaTV", "Stock VGA (Terminal Velocity, Fury3)"],
];

export async function importImages(app) {
  if (!app.doc) return;
  const [file] = await pickFiles({ multiple: false, accept: "image/png,image/bmp,image/jpeg,image/gif,image/webp,.tga,.png,.bmp,.jpg,.jpeg,.gif,.webp" });
  if (!file) return;
  let image;
  try {
    image = await decodeImageFile(app, file);
  } catch (error) {
    await alertDialog("Import Image", `${file.name} could not be read: ${error.message}`);
    return;
  }

  const stem = file.name.replace(/\.[^.]*$/, "").toUpperCase().replace(/[^A-Z0-9_\-]/g, "_");
  const folder = app.targetFolder() || (app.doc.entries.some((e) => e.normalizedName.startsWith("ART/")) ? "ART" : "");
  const square = image.width === image.height;
  const actEntries = app.doc.entries.filter((e) => e.title.toUpperCase().endsWith(".ACT"));

  const body = document.createElement("div");
  body.className = "import-form";
  body.innerHTML = `
    <p class="modal-text"><strong></strong> · ${image.width}×${image.height}</p>
    <label class="modal-field-label">Entry name<input type="text" class="modal-input import-name" spellcheck="false"></label>
    <label class="choice-row"><input type="radio" name="import-mode" value="own"> <span>Own palette (also adds <span class="import-act"></span>)</span></label>
    <label class="choice-row"><input type="radio" name="import-mode" value="existing"> <span>Existing palette</span></label>
    <select class="modal-select import-palette"></select>
    <p class="modal-hint import-warning"></p>
    <div class="import-preview"><canvas></canvas></div>`;
  body.querySelector("strong").textContent = file.name;
  const nameInput = body.querySelector(".import-name");
  nameInput.value = joinEntry(folder, `${stem}.RAW`);
  const actLabel = body.querySelector(".import-act");
  const paletteSelect = body.querySelector(".import-palette");
  const warning = body.querySelector(".import-warning");
  const canvas = body.querySelector("canvas");
  const [ownRadio, existingRadio] = body.querySelectorAll('input[name="import-mode"]');
  for (const entry of actEntries) paletteSelect.add(new Option(entry.name, `entry:${entry.id}`));
  for (const [id, label] of BUNDLED) paletteSelect.add(new Option(label, `bundled:${id}`));
  (square ? ownRadio : existingRadio).checked = true;

  let result = null;
  let token = 0;
  const actName = () => nameInput.value.trim().replace(/\.RAW$/i, "") + ".ACT";
  const mode = () => (ownRadio.checked ? "own" : "existing");

  const refresh = async () => {
    const mine = ++token;
    actLabel.textContent = actName();
    paletteSelect.disabled = mode() === "own";
    const notes = [];
    if (!square) notes.push("Classic RAW textures are square; this image is not, so only an existing palette can be used and most games will not draw it.");
    else if ((image.width & (image.width - 1)) !== 0) notes.push("Classic textures are 64, 128 or 256 pixels on a side.");
    if (mode() === "own" && !square) { warning.textContent = notes.join(" "); result = null; return; }
    let palette = null;
    if (mode() === "existing") palette = await selectedPalette(app, paletteSelect.value, actEntries);
    const encoded = await app.workerClient.call("encodeRaw", { rgba: image.rgba.slice(), width: image.width, height: image.height, palette: palette?.slice() ?? null });
    if (mine !== token) return;
    result = { raw: encoded.raw, act: mode() === "own" ? encoded.act : null };
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(encoded.preview), image.width, image.height), 0, 0);
    warning.textContent = notes.join(" ");
  };
  for (const el of [ownRadio, existingRadio, paletteSelect]) el.addEventListener("change", refresh);
  nameInput.addEventListener("input", () => { actLabel.textContent = actName(); });
  const ready = refresh();

  const answer = await openDialog({
    title: "Import Image as RAW",
    body,
    wide: true,
    buttons: [{ label: "Cancel", value: null }, { label: "Import", value: "ok", primary: true }],
    beforeClose: () => {
      const name = nameInput.value.trim();
      const problem = !/\.RAW$/i.test(name) ? "The entry name must end in .RAW." : pathProblem(name.replace(/\//g, "\\"));
      if (problem) { warning.textContent = problem; return false; }
      if (!result) { warning.textContent = warning.textContent || "Choose an existing palette for this image."; return false; }
      return true;
    },
  });
  await ready;
  if (answer !== "ok" || !result) return;

  const rawName = nameInput.value.trim();
  const files = [{ name: rawName, bytes: result.raw }];
  if (result.act) files.push({ name: actName(), bytes: result.act });
  const clashes = files.filter((f) => app.doc.indexOfKey(f.name) >= 0).map((f) => f.name);
  if (clashes.length) {
    const ok = await openDialog({
      title: "Entries already exist",
      body: `${clashes.join(" and ")} already ${clashes.length === 1 ? "exists" : "exist"}. Replace?`,
      buttons: [{ label: "Cancel", value: null }, { label: "Replace", value: true, primary: true }],
    });
    if (!ok) return;
  }
  const items = [];
  for (const f of files) {
    const source = await app.stageBytes(f.bytes);
    items.push({ name: f.name, length: f.bytes.length, timestamp: Math.floor(Date.now() / 1000), source });
  }
  const added = await app.edit("Import Image", (d) => addEntries(d, items, { replace: () => true }));
  if (added) {
    for (const key of folderKeys(rawName)) app.view.collapsed.delete(key);
    app.renderList();
    app.list.selectEntries(added.entries.map((e) => e.id));
    app.preview(added.entries[0]);
    app.setStatus(`Imported ${file.name} as ${files.map((f) => f.name).join(" + ")}.`);
  }
}

async function selectedPalette(app, value, actEntries) {
  if (value.startsWith("bundled:")) return PALETTES[value.slice(8)];
  const entry = actEntries.find((e) => `entry:${e.id}` === value);
  if (!entry) return null;
  return decodeActPalette(await app.getEntryBytes(entry));
}

async function decodeImageFile(app, file) {
  if (/\.tga$/i.test(file.name)) {
    const image = await app.workerClient.call("decodeTgaImage", { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name });
    return { width: image.width, height: image.height, rgba: new Uint8Array(image.rgba.buffer ?? image.rgba) };
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return { width: bitmap.width, height: bitmap.height, rgba: new Uint8Array(data.buffer) };
  } finally {
    bitmap.close();
  }
}

function folderKeys(name) {
  const parts = entryKey(name).split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}
