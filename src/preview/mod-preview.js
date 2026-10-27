/*
  ProTracker .MOD music: rendered to PCM in the worker by OpenPhotex (parseMod, renderMod),
  then played through an <audio> element as a 16-bit WAV, which gives play, pause, seek and time.
*/
let objectUrl = null;

export async function render(container, bytes, { workerClient }) {
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  const info = document.createElement("p");
  info.className = "preview-info";
  info.textContent = "Rendering module...";
  container.replaceChildren(info);
  const pcm = await workerClient.call("renderMod", { bytes });
  if (!pcm) {
    info.textContent = "Not a ProTracker module this player understands.";
    return;
  }
  objectUrl = URL.createObjectURL(encodeWav(new Float32Array(pcm.left), new Float32Array(pcm.right), pcm.sampleRate));
  const audio = document.createElement("audio");
  audio.className = "wav-player";
  audio.controls = true;
  audio.src = objectUrl;
  info.textContent = `${pcm.title || "Untitled"} · ${pcm.channels} channels · ${(pcm.left.length / pcm.sampleRate).toFixed(1)} s`;
  container.replaceChildren(info, audio);
}

function encodeWav(left, right, sampleRate) {
  const frames = left.length;
  const buffer = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(buffer);
  const ascii = (at, text) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + frames * 4, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, frames * 4, true);
  const clamp = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0, at = 44; i < frames; i++, at += 4) {
    view.setInt16(at, clamp(left[i]), true);
    view.setInt16(at + 2, clamp(right[i]), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
