/*
  POD and EPD archives.

  Parsing is OpenPhotex's (src/vendor/openphotex, the canonical Terminal Reality format
  library): this file reads only the directory out of the OPFS file and hands it over. Do not
  add format knowledge here; change OpenPhotex and re-vendor it.
*/
import { parsePod, podDirectoryEnd, findPodEntry, findPodEntryByTitle, findPodEntriesByExtension } from "../vendor/openphotex/index.js";
import { readFile } from "../shared/opfs.js";

// The spellings the archive info bar has always shown.
const FORMAT_NAMES = { pod1: "POD1", pod2: "POD2", epd: "EPD" };

export async function indexPodFile(opfsPodPath) {
  const file = await readFile(opfsPodPath);
  let prefix = new Uint8Array(0);
  for (;;) {
    const need = podDirectoryEnd(prefix, file.size);
    if (need <= prefix.length) break;
    prefix = new Uint8Array(await file.slice(0, need).arrayBuffer());
  }
  const pod = parsePod(prefix, { byteLength: file.size });
  return { ...pod, format: FORMAT_NAMES[pod.format] };
}

/**
 * An entry's bytes. Entries of the document being edited say where their bytes live
 * (src/model/pod-document.js); a bare archive entry is read from `opfsPodPath`.
 */
export async function readPodEntryBytes(opfsPodPath, entry) {
  const source = entry.source ?? { kind: "archive", path: opfsPodPath, offset: entry.offset, length: entry.length };
  const file = await readFile(source.path);
  if (source.kind === "blob") return new Uint8Array(await file.arrayBuffer());
  const buffer = await file.slice(source.offset, source.offset + entry.length).arrayBuffer();
  return new Uint8Array(buffer);
}

/** The raw 80-byte comment field of a POD1 or POD2 (offset 4 or 8), or null for EPD. */
export async function readRawComment(opfsPodPath, format) {
  const at = format === "pod2" ? 8 : format === "pod1" ? 4 : -1;
  if (at < 0) return null;
  const file = await readFile(opfsPodPath);
  return new Uint8Array(await file.slice(at, at + 80).arrayBuffer());
}

export function findEntry(podIndex, normalizedName) {
  return findPodEntry(podIndex, normalizedName);
}

export function findEntryByTitle(podIndex, title) {
  return findPodEntryByTitle(podIndex, title);
}

export function findEntryFlexible(podIndex, name) {
  return findEntry(podIndex, name) ?? findEntryByTitle(podIndex, name);
}

export function findEntriesByExtension(podIndex, ext) {
  return findPodEntriesByExtension(podIndex, ext);
}
