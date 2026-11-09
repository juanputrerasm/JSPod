let currentObjectUrl = null;

// Community Patch 4 ships its music as Ogg Vorbis and MP3. They play through the same
// audio element as .WAV, with the MIME type the blob needs for the browser to pick a decoder.
export function render(container, bytes, mime = "audio/wav") {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  const blob = new Blob([bytes], { type: mime });
  currentObjectUrl = URL.createObjectURL(blob);
  const audio = document.createElement("audio");
  audio.className = "wav-player";
  audio.controls  = true;
  audio.autoplay  = true;
  audio.preload   = "auto";
  audio.src       = currentObjectUrl;
  const note = document.createElement("p");
  note.className = "preview-error";
  note.hidden = true;
  const showNote = () => {
    note.textContent = `This browser cannot decode ${mime} audio. Download the entry to play it elsewhere.`;
    note.hidden = false;
  };
  if (typeof audio.canPlayType === "function" && audio.canPlayType(mime) === "") showNote();
  audio.addEventListener("error", showNote);
  container.replaceChildren(audio, note);
  // Selecting an entry is a user gesture, so playback is normally allowed.
  // Keep the controls usable if a browser's autoplay policy still rejects it.
  void audio.play().catch(() => {});
}
