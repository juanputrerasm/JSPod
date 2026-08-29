export async function render(container, bytes, context) {
  const decoded = await context.workerClient.call("decodeImage", {
    bytes,
    name: context.entry?.title ?? "texture.tga",
    format: "TGA"
  });
  const canvas = document.createElement("canvas");
  canvas.className = "image-preview";
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const rgba = decoded.rgba instanceof Uint8ClampedArray
    ? decoded.rgba
    : new Uint8ClampedArray(decoded.rgba.buffer, decoded.rgba.byteOffset, decoded.rgba.byteLength);
  canvas.getContext("2d").putImageData(new ImageData(rgba, decoded.width, decoded.height), 0, 0);
  container.replaceChildren(canvas);
}
