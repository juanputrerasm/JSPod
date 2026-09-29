/*
  8-bit textures and palettes.

  Decoding is OpenPhotex's (src/vendor/openphotex): the .ACT bit-depth rule, palette mapping and
  .OPA opacity planes. What stays here is the viewer's own behaviour: previewing a .RAW at any
  size the user picks, guessing that size from the byte count, and a greyscale ramp when there
  is no palette at all.
*/
import { applyOpacityPlane, decodeActPalette, decodeIndexedImage } from "../vendor/openphotex/index.js";

export { applyOpacityPlane, decodeActPalette };

const PALETTE_SIZE = 256 * 3;

export function decodeRawTexture(rawBytes, actBytes, textureName, width, height) {
  const palette = (actBytes && decodeActPalette(actBytes)) ?? makeGreyscalePalette();

  // Determine dimensions if not explicitly provided
  let w = width ?? 0;
  let h = height ?? 0;
  if (!w || !h) {
    // Best-effort: a known size, then the nearest square.
    const side = Math.floor(Math.sqrt(rawBytes.length));
    [w, h] = detectDimensions(rawBytes.length) ?? [side, side];
  }

  const { rgba } = decodeIndexedImage(rawBytes, palette, w, h);
  return { name: textureName, width: w, height: h, rgba, sourceFormat: "RAW" };
}

export function detectDimensions(byteCount) {
  if (byteCount === 4096)  return [64, 64];
  if (byteCount === 65536) return [256, 256];
  // Common non-square defaults
  if (byteCount === 64000)  return [320, 200];
  if (byteCount === 256000) return [640, 400];
  if (byteCount === 307200) return [640, 480];
  // Try perfect square
  const side = Math.round(Math.sqrt(byteCount));
  if (side * side === byteCount) return [side, side];
  return null;
}

export function suggestDimensions(byteCount) {
  const suggestions = [];
  const seen = new Set();
  for (let w = 1; w * w <= byteCount; w++) {
    if (byteCount % w === 0) {
      const h = byteCount / w;
      const key1 = `${w}x${h}`;
      const key2 = `${h}x${w}`;
      if (!seen.has(key1)) {
        seen.add(key1); seen.add(key2);
        const squareness = Math.min(w / h, h / w);
        suggestions.push({ w, h, squareness });
        if (w !== h) suggestions.push({ w: h, h: w, squareness });
      }
    }
  }
  // Sort by squareness descending (closest to square first)
  suggestions.sort((a, b) => b.squareness - a.squareness);
  return suggestions;
}

function makeGreyscalePalette() {
  const p = new Uint8Array(PALETTE_SIZE);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = p[i * 3 + 1] = p[i * 3 + 2] = i;
  }
  return p;
}
