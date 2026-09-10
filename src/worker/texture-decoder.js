const PALETTE_SIZE = 256 * 3; // 768 bytes

export function decodeActPalette(actBytes) {
  if (!actBytes || actBytes.length < PALETTE_SIZE) return null;
  const raw = actBytes.subarray(0, PALETTE_SIZE);
  // Auto-detect 6-bit VGA vs 8-bit Adobe ACT:
  // If any channel byte > 63, it's a full 8-bit palette (use directly).
  // Otherwise scale 6-bit VGA: (v * 255 + 31) / 63  (maps 0→0, 63→255 exactly)
  let is8bit = false;
  for (let i = 0; i < PALETTE_SIZE; i++) {
    if (raw[i] > 63) { is8bit = true; break; }
  }
  if (is8bit) return raw.slice();
  const out = new Uint8Array(PALETTE_SIZE);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    out[i] = Math.round((raw[i] * 255 + 31) / 63);
  }
  return out;
}

/*
  Merges a 4x4 Evolution .OPA opacity plane into a decoded image.

  An .OPA is an unheadered byte per pixel, paired with its texture by stem, and it holds a
  real gradient rather than a mask - AS3PINE1.OPA uses all 256 levels. That is the difference
  from the MTM family, which has no alpha anywhere and cuts texels by colour key instead, so
  an .OPA must not be routed through that path or every soft foliage edge hardens into a
  stencil.

  A plane whose length does not match the image's pixel count means the pairing was wrong,
  not that the plane needs resampling, so it is ignored rather than stretched.
*/
export function applyOpacityPlane(decoded, opaBytes) {
  if (!decoded || !opaBytes) return decoded;
  const pixels = decoded.width * decoded.height;
  if (opaBytes.length !== pixels) return decoded;
  for (let i = 0; i < pixels; i++) decoded.rgba[i * 4 + 3] = opaBytes[i];
  return { ...decoded, hasAlpha: true };
}

export function decodeRawTexture(rawBytes, actBytes, textureName, width, height) {
  const palette = actBytes ? (decodeActPalette(actBytes) ?? makeGreyscalePalette()) : makeGreyscalePalette();

  // Determine dimensions if not explicitly provided
  let w = width ?? 0;
  let h = height ?? 0;
  if (!w || !h) {
    const dims = detectDimensions(rawBytes.length);
    if (!dims) {
    // Best-effort: try square root, then 64×64 fallback
    const side = Math.floor(Math.sqrt(rawBytes.length));
    dims = [side, side];
  }
    [w, h] = dims;
  }

  const rgba = new Uint8ClampedArray(w * h * 4);
  const pixels = Math.min(rawBytes.length, w * h);
  for (let i = 0; i < pixels; i++) {
    const ci = rawBytes[i] * 3;
    const o  = i * 4;
    rgba[o]     = palette[ci];
    rgba[o + 1] = palette[ci + 1];
    rgba[o + 2] = palette[ci + 2];
    rgba[o + 3] = 255;
  }
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
