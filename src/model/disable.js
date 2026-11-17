/*
  Disable or enable a track or truck in the game by renaming it to an extension the engine
  passes over: .TRK/.TRX, .SIT/.SIX, .SI2/.SIY, .SI3/.SIZ. Nothing is deleted, and renaming back
  restores the addon exactly. .SI3 is the situation file of track format version 6
  (https://openmtm2.github.io/proposals/track-format-v6); .SIZ continues KPod's X, Y letters and is
  JSPod's own choice, not part of that specification. The archive's own casing is kept. Port of KPod's PodEntryDisabling.
*/
const PAIRS = [[".TRK", ".TRX"], [".SIT", ".SIX"], [".SI2", ".SIY"], [".SI3", ".SIZ"]];

/** The disabled name, or null when the entry is not an enabled track or truck. */
export function disabledName(name) {
  return swap(name, false);
}

/** The enabled name, or null when the entry is not a disabled track or truck. */
export function enabledName(name) {
  return swap(name, true);
}

function swap(name, enable) {
  const entry = String(name ?? "");
  for (const [on, off] of PAIRS) {
    const from = enable ? off : on;
    if (entry.toUpperCase().endsWith(from)) {
      const to = enable ? on : off;
      const last = entry[entry.length - 1];
      const replacement = last !== last.toUpperCase() ? to.toLowerCase() : to;
      return entry.slice(0, entry.length - from.length) + replacement;
    }
  }
  return null;
}
