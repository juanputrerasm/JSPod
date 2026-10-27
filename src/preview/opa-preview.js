/*
  .OPA opacity planes: one byte of opacity per texel, as a .RAW has one palette index per texel.
  Shown as greyscale (white is opaque) over a checkerboard.
*/
import { detectDimensions } from "../worker/texture-decoder.js";

export function render(container, bytes) {
  const dims = detectDimensions(bytes.length) ?? squareOf(bytes.length);
  if (!dims) {
    const p = document.createElement("p");
    p.className = "preview-info";
    p.textContent = `Opacity plane of ${bytes.length} bytes: not a square texture size, shown as hex instead.`;
    container.replaceChildren(p);
    return false;
  }
  const [width, height] = dims;
  const canvas = document.createElement("canvas");
  canvas.className = "image-preview raw-canvas";
  canvas.width = width;
  canvas.height = height;
  const image = new ImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = bytes[i];
    image.data.set([v, v, v, 255], i * 4);
  }
  canvas.getContext("2d").putImageData(image, 0, 0);
  canvas.style.width = `${Math.max(width, Math.min(512, width * 4))}px`;
  const info = document.createElement("p");
  info.className = "preview-info";
  info.textContent = `Opacity plane ${width}×${height}. White is opaque, black transparent.`;
  container.replaceChildren(info, canvas);
  return true;
}

function squareOf(length) {
  const side = Math.round(Math.sqrt(length));
  return side * side === length ? [side, side] : null;
}
