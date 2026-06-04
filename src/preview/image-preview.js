export function render(container, bytes, mimeType = "image/png") {
  const blob = new Blob([bytes], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const img  = document.createElement("img");
  img.className = "image-preview";
  img.onload = () => URL.revokeObjectURL(url);
  img.onerror = () => {
    URL.revokeObjectURL(url);
    container.replaceChildren(errorMsg("Could not decode image."));
  };
  img.src = url;
  container.replaceChildren(img);
}

function errorMsg(text) {
  const p = document.createElement("p");
  p.className = "preview-error";
  p.textContent = text;
  return p;
}
