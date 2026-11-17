import { render as renderRaw }   from "./raw-preview.js";
import { render as renderAct }   from "./act-preview.js";
import { render as renderText }  from "./text-preview.js";
import { dispose as disposeBin, render as renderBin } from "./bin-preview.js";
import { render as renderWav }   from "./wav-preview.js";
import { render as renderImage } from "./image-preview.js";
import { render as renderTga }   from "./tga-preview.js";
import { render as renderHex }   from "./hex-preview.js";
import { render as renderTiff }  from "./tiff-preview.js";
import { render as renderMod }   from "./mod-preview.js";
import { render as renderOpa }   from "./opa-preview.js";
import { renderMwtr, renderMveg, renderMwfl, renderHeightmap } from "./cp4-world-preview.js";
import { heightmapRawLayout } from "../model/cp4-world.js";
import { isWtr, isMtm2Veg, isWfl } from "../vendor/openphotex/index.js";

const TEXT_EXTENSIONS = new Set([
  "TXT","DEF","LVL","SIT","INI","LST","INF","CFG","TEX","TNL","TTX",
  "TRK","TRN","NDX","MIC","NAV","TDF","VOX","JSIN","TTY","JSON","CRS",
  "DVP","GLT","PIT","LVO","LOC","DMO", "LOG", "CAR", "200", "400", "480", "ANI", "KLP", "SET",
  // CommPatch tracks, track format version 6 tracks (.SI3, the same text as a .SI2), and the
  // disabled forms of tracks and trucks. Disabling only renames the file, so the payload is the
  // same text it was before.
  "SI2","SI3","SIX","SIY","SIZ","TRX","TXV",
  // 4x4 Evolution world files, all line-oriented text like the rest of the family.
  "VEG","WAT",
  // Community Patch 4: the 3D cockpit layout and the per-model surface material sidecar.
  "CPT","SRF"
]);

const AUDIO_MIME = { WAV: "audio/wav", OGG: "audio/ogg", MP3: "audio/mpeg" };

const IMAGE_EXTENSIONS = new Set(["BMP","PNG","JPG","JPEG","GIF","WEBP"]);
const IMAGE_MIME = {
  BMP: "image/bmp", PNG: "image/png", JPG: "image/jpeg",
  JPEG: "image/jpeg", GIF: "image/gif", WEBP: "image/webp"
};

export async function dispatch(container, bytes, context) {
  disposeBin();
  const ext = (context.entry?.title ?? "").toUpperCase().replace(/.*\./, "");
  // bin-active removes container padding so the 3-D viewport can fill the full panel.
  // Must be toggled before rendering so the layout is already correct when the scene sizes itself.
  container.classList.toggle("bin-active", ext === "BIN" || ext === "LWO" || ext === "SMF" || ext === "CMD" || ext === "DFM" || ext === "KFM");

  try {
    // KPod shows .CLR the way it shows .RAW: one palette index per texel.
    // A CP4 16-bit DATA heightmap is not a paletted texture; it gets its own greyscale view.
    const heightmap = ext === "RAW" ? heightmapRawLayout(context.entry?.name, bytes.length) : null;
    if (heightmap) {
      renderHeightmap(container, bytes, heightmap);
      addPngExport(container, context);
      return;
    }
    if (ext === "RAW" || ext === "CLR") {
      await renderRaw(container, bytes, context);
      addPngExport(container, context);
      return;
    }
    if (ext === "OPA") {
      if (renderOpa(container, bytes)) { addPngExport(container, context); return; }
      renderHex(container, bytes);
      return;
    }
    if (ext === "MOD") {
      await renderMod(container, bytes, context);
      return;
    }
    if (ext === "ACT") {
      renderAct(container, bytes);
      return;
    }
    if (ext === "TGA") {
      await renderTga(container, bytes, context);
      addPngExport(container, context);
      return;
    }
    // .SMF and CPR .CMD use their own decoders but emit the same mesh shape as .BIN,
    // allowing all three formats to share the interactive model viewer.
    if (ext === "BIN" || ext === "LWO" || ext === "SMF" || ext === "CMD" || ext === "DFM" || ext === "KFM") {
      await renderBin(container, bytes, context);
      return;
    }
    if (ext === "TIF" || ext === "TIFF") {
      await renderTiff(container, bytes, context);
      addPngExport(container, context);
      return;
    }
    if (AUDIO_MIME[ext]) {
      renderWav(container, bytes, AUDIO_MIME[ext]);
      return;
    }
    // CP4 writes binary .VEG ("MVEG") and .WTR ("MWTR"), and beta 0.53 adds .WFL ("MWFL").
    // 4x4 Evolution's .VEG is text with no magic, so anything else in a .VEG falls through to
    // the text preview.
    const cp4World = ext === "VEG" || ext === "WTR" || ext === "WFL";
    if (cp4World && isWtr(bytes)) {
      renderMwtr(container, bytes);
      return;
    }
    if (cp4World && isMtm2Veg(bytes)) {
      renderMveg(container, bytes);
      return;
    }
    if (cp4World && isWfl(bytes)) {
      renderMwfl(container, bytes);
      return;
    }
    if (TEXT_EXTENSIONS.has(ext)) {
      renderText(container, bytes, context);
      return;
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
      renderImage(container, bytes, IMAGE_MIME[ext] ?? "image/png");
      return;
    }
  } catch (err) {
    const p = document.createElement("p");
    p.className = "preview-error";
    p.textContent = `Preview error: ${err.message}`;
    container.replaceChildren(p);
    return;
  }

  // Fallback: hex dump
  renderHex(container, bytes);
}

/**
 * Adds "Save as PNG" for an image preview. It saves whatever the preview's canvas shows at the
 * time of the click, so a RAW is saved with the palette currently chosen.
 */
function addPngExport(container, context) {
  if (!container.querySelector("canvas")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-small png-export";
  button.textContent = "⬇ Save as PNG";
  button.addEventListener("click", () => {
    const canvas = container.querySelector("canvas");
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (context.entry?.title ?? "image").replace(/\.[^.]*$/, "") + ".png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, "image/png");
  });
  const controls = container.querySelector(".raw-controls");
  if (controls) controls.appendChild(button);
  else {
    const bar = document.createElement("div");
    bar.className = "raw-controls";
    bar.appendChild(button);
    container.prepend(bar);
  }
}
