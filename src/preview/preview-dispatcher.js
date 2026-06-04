import { render as renderRaw }   from "./raw-preview.js";
import { render as renderAct }   from "./act-preview.js";
import { render as renderText }  from "./text-preview.js";
import { render as renderBin }   from "./bin-preview.js";
import { render as renderWav }   from "./wav-preview.js";
import { render as renderImage } from "./image-preview.js";
import { render as renderHex }   from "./hex-preview.js";

const TEXT_EXTENSIONS = new Set([
  "TXT","DEF","LVL","SIT","INI","LST","INF","CFG","TEX","TNL","TTX","TXX",
  "TRK","TRN","NDX","MIC","NAV","TDF","VOX","JSIN","TTY","TVI","JSON","CRS",
  "DVP","GLT","PIT","LVO","LOC","DMO", "LOG", "RGN", "CMD", "CAR", "200", "400", "480"
]);

const IMAGE_EXTENSIONS = new Set(["BMP","PNG","JPG","JPEG","GIF","WEBP"]);
const IMAGE_MIME = {
  BMP: "image/bmp", PNG: "image/png", JPG: "image/jpeg",
  JPEG: "image/jpeg", GIF: "image/gif", WEBP: "image/webp"
};

export async function dispatch(container, bytes, context) {
  const ext = (context.entry?.title ?? "").toUpperCase().replace(/.*\./, "");
  // bin-active removes container padding so the 3-D viewport can fill the full panel.
  // Must be toggled before rendering so the layout is already correct when the scene sizes itself.
  container.classList.toggle("bin-active", ext === "BIN" || ext === "LWO");

  try {
    if (ext === "RAW" || ext === "CLR") {
      await renderRaw(container, bytes, context);
      return;
    }
    if (ext === "ACT") {
      renderAct(container, bytes);
      return;
    }
    if (ext === "BIN" || ext === "LWO") {
      await renderBin(container, bytes, context);
      return;
    }
    if (ext === "WAV") {
      renderWav(container, bytes);
      return;
    }
    if (TEXT_EXTENSIONS.has(ext)) {
      renderText(container, bytes);
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
