/*
  Palette-indexed TIFF, the form 4x4 Evolution 2 keeps its model and vegetation art in.

  Browsers do not decode TIFF, so this cannot go through the same path as .PNG. It is drawn
  on a checkerboard because most of these files carry a second sample that is an opacity
  plane, and a tree or a fence rendered on flat white looks like art with a white background
  rather than art with a hole in it.
*/
export async function render(container, bytes, context) {
  const decoded = await context.workerClient.call("decodeTiff", {
    bytes,
    name: context.entry?.title ?? "texture.tif"
  });

  const canvas = document.createElement("canvas");
  canvas.className = "image-preview";
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const rgba = decoded.rgba instanceof Uint8ClampedArray
    ? decoded.rgba
    : new Uint8ClampedArray(decoded.rgba.buffer, decoded.rgba.byteOffset, decoded.rgba.byteLength);

  const context2d = canvas.getContext("2d");
  if (decoded.hasAlpha) {
    const SQUARE = 8;
    for (let y = 0; y < decoded.height; y += SQUARE) {
      for (let x = 0; x < decoded.width; x += SQUARE) {
        context2d.fillStyle = ((x / SQUARE) ^ (y / SQUARE)) & 1 ? "#3a3a40" : "#2a2a2e";
        context2d.fillRect(x, y, SQUARE, SQUARE);
      }
    }
    // putImageData ignores what is already on the canvas, so the image is composited
    // through a second canvas rather than written straight over the checkerboard.
    const layer = document.createElement("canvas");
    layer.width = decoded.width;
    layer.height = decoded.height;
    layer.getContext("2d").putImageData(new ImageData(rgba, decoded.width, decoded.height), 0, 0);
    context2d.drawImage(layer, 0, 0);
  } else {
    context2d.putImageData(new ImageData(rgba, decoded.width, decoded.height), 0, 0);
  }

  const caption = document.createElement("p");
  caption.className = "preview-caption";
  caption.textContent = `${decoded.width}x${decoded.height} palette-indexed TIFF`
    + (decoded.hasAlpha ? ", with an opacity sample" : "");

  container.replaceChildren(canvas, caption);
}
