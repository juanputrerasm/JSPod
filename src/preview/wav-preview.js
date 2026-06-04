let currentObjectUrl = null;

export function render(container, bytes) {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  const blob = new Blob([bytes], { type: "audio/wav" });
  currentObjectUrl = URL.createObjectURL(blob);
  const audio = document.createElement("audio");
  audio.className = "wav-player";
  audio.controls  = true;
  audio.src       = currentObjectUrl;
  container.replaceChildren(audio);
}
