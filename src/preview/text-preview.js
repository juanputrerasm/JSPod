const decoder = new TextDecoder("latin1");

export function render(container, bytes) {
  const text = decoder.decode(bytes);
  const pre  = document.createElement("pre");
  pre.className = "text-preview";
  pre.textContent = text;
  container.replaceChildren(pre);
}
