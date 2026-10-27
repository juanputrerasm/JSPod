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
  audio.autoplay  = true;
  audio.preload   = "auto";
  audio.src       = currentObjectUrl;
  container.replaceChildren(audio);
  // Selecting an entry is a user gesture, so playback is normally allowed.
  // Keep the controls usable if a browser's autoplay policy still rejects it.
  void audio.play().catch(() => {});
}
