/*
  Mounting a POD in the game's pod.ini, as KPod's PodIniMounter does it.

    3              line 1: how many PODs are mounted
    GAME.POD       one mounted POD per line
    ...

  The same POD may not be mounted twice. At 99 or more mounted PODs the mount still happens but
  the caller should warn. Output uses CRLF line ends.
*/
const RECOMMENDED_MAX = 99;

export class AlreadyMountedError extends Error {
  constructor(label) {
    super(`POD already mounted: ${label}`);
    this.name = "AlreadyMountedError";
  }
}

/** @returns {{text: string, limitExceeded: boolean}} the new pod.ini text */
export function mountInPodIni(text, label) {
  const lines = String(text ?? "").split(/\r?\n/);
  while (lines.length > 1 && lines.at(-1).trim() === "") lines.pop();
  if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === "")) lines.splice(0, lines.length, "0");
  const count = Number.parseInt(lines[0].trim(), 10) || 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim().toUpperCase() === label.trim().toUpperCase()) throw new AlreadyMountedError(label);
  }
  const out = [String(count + 1), ...lines.slice(1), label];
  return { text: out.join("\r\n") + "\r\n", limitExceeded: count >= RECOMMENDED_MAX };
}
