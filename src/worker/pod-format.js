import { archiveTitle, normalizeArchiveName } from "../shared/path-utils.js";
import { readFile } from "../shared/opfs.js";

const MAX_REASONABLE_ITEMS = 65536;
const POD1_MAX_ITEMS = 8192;

// ─── POD1 constants ──────────────────────────────────────────────────────────
const POD1_ENTRY_NAME_SIZE = 32;
const POD1_COMMENT_SIZE    = 80;
const POD1_ENTRY_SIZE      = 40;
const POD1_HEADER_SIZE     = 84; // 4 count + 80 comment
const POD1_LONG_NAME_SIZE  = 64;
const POD1_LONG_ENTRY_SIZE = 72;

// ─── POD2 constants ──────────────────────────────────────────────────────────
const POD2_COMMENT_OFFSET  = 8;
const POD2_COMMENT_SIZE    = 80;
const POD2_COUNT_OFFSET    = 88;
const POD2_TABLE_OFFSET    = 96;  // 4 magic + 4 ? + 80 comment + 4 count + 4 checksum
const POD2_ENTRY_SIZE      = 20;

// ─── EPD constants ────────────────────────────────────────────────────────────
const EPD_COUNT_OFFSET     = 0x90;
const EPD_TABLE_OFFSET     = 0x110;
const EPD_ENTRY_SIZE       = 80;
const EPD_PREFIX_SIZE      = 4;
const EPD_SUFFIX_SIZE      = 60;

const decoder = new TextDecoder("latin1");

export async function indexPodFile(opfsPodPath) {
  const file = await readFile(opfsPodPath);
  if (file.size < 4) throw new Error(`File too small to be a valid archive: ${opfsPodPath}`);

  // Read first 4 bytes to detect format
  const sigBuffer = await file.slice(0, 4).arrayBuffer();
  const sig = new TextDecoder("latin1").decode(new Uint8Array(sigBuffer));

  if (sig === "dtxe") return readEpd(file);
  if (sig === "POD2") return readPod2(file);
  return readPod1(file);
}

// ─── POD1 ─────────────────────────────────────────────────────────────────────
async function readPod1(file) {
  if (file.size < POD1_HEADER_SIZE) throw new Error("File too small to be a POD1 archive.");
  const headerBuffer = await file.slice(0, POD1_HEADER_SIZE).arrayBuffer();
  const headerView   = new DataView(headerBuffer);
  const headerBytes  = new Uint8Array(headerBuffer);
  const itemCount    = headerView.getInt32(0, true);
  validateCount(itemCount, POD1_MAX_ITEMS);
  const comment      = decodeNullTerminated(headerBytes, 4, POD1_COMMENT_SIZE);
  const legacy = await tryReadPod1Directory(file, itemCount, POD1_ENTRY_NAME_SIZE, POD1_ENTRY_SIZE);
  if (legacy) return { format: "POD1", comment, entries: legacy };
  const extended = await tryReadPod1Directory(file, itemCount, POD1_LONG_NAME_SIZE, POD1_LONG_ENTRY_SIZE);
  if (extended) return { format: "Extended POD1", comment, entries: extended };
  throw new Error("POD1 directory is neither a valid 32-byte nor 64-byte layout.");
}

async function tryReadPod1Directory(file, itemCount, nameSize, entrySize) {
  const tableBytes = itemCount * entrySize;
  if (POD1_HEADER_SIZE + tableBytes > file.size) return null;
  const tableBuffer  = await file.slice(POD1_HEADER_SIZE, POD1_HEADER_SIZE + tableBytes).arrayBuffer();
  const tableView    = new DataView(tableBuffer);
  const tableBytes8  = new Uint8Array(tableBuffer);
  const entries      = [];
  try {
    for (let i = 0; i < itemCount; i++) {
      const base       = i * entrySize;
      const { name, paletteName, pathTerminated } = decodePod1NameField(tableBytes8, base, nameSize);
      const length     = tableView.getUint32(base + nameSize, true);
      const dataOffset = tableView.getUint32(base + nameSize + 4, true);
      if (!pathTerminated || !name || !isPlausibleArchivePath(name)) return null;
      validateEntry(name, length, dataOffset, file.size);
      entries.push(makeEntry(name, length, dataOffset, paletteName));
    }
  } catch {
    return null;
  }
  return entries;
}

// ─── POD2 ─────────────────────────────────────────────────────────────────────
async function readPod2(file) {
  const minSize = POD2_TABLE_OFFSET + 4;
  if (file.size < minSize) throw new Error("File too small to be a POD2 archive.");
  const headBuffer = await file.slice(0, POD2_TABLE_OFFSET).arrayBuffer();
  const headBytes  = new Uint8Array(headBuffer);
  const headView   = new DataView(headBuffer);
  const comment    = decodeNullTerminated(headBytes, POD2_COMMENT_OFFSET, POD2_COMMENT_SIZE);
  const itemCount  = headView.getUint32(POD2_COUNT_OFFSET, true);
  validateCount(itemCount);
  const tableSize  = itemCount * POD2_ENTRY_SIZE;
  if (POD2_TABLE_OFFSET + tableSize > file.size) throw new Error("POD2 item table exceeds file size.");
  const tableBuffer   = await file.slice(POD2_TABLE_OFFSET, POD2_TABLE_OFFSET + tableSize).arrayBuffer();
  const tableView     = new DataView(tableBuffer);
  const nameTableBase = POD2_TABLE_OFFSET + tableSize;
  // Read entire name table so we can index into it
  const nameTableBuffer = await file.slice(nameTableBase).arrayBuffer();
  const nameTableBytes  = new Uint8Array(nameTableBuffer);
  const entries = [];
  for (let i = 0; i < itemCount; i++) {
    const base       = i * POD2_ENTRY_SIZE;
    const pathOffset = tableView.getUint32(base + 0, true);
    const length     = tableView.getUint32(base + 4, true);
    const dataOffset = tableView.getUint32(base + 8, true);
    const name       = decodeNullTerminatedFromTable(nameTableBytes, pathOffset);
    validateEntry(name, length, dataOffset, file.size);
    entries.push(makeEntry(name, length, dataOffset));
  }
  return { format: "POD2", comment, entries };
}

// ─── EPD ──────────────────────────────────────────────────────────────────────
async function readEpd(file) {
  const minSize = EPD_COUNT_OFFSET + 4;
  if (file.size < minSize) throw new Error("File too small to be an EPD archive.");
  // Read comment from bytes 4..7 (4-byte title)
  const titleBuffer = await file.slice(4, 8).arrayBuffer();
  const comment     = decoder.decode(new Uint8Array(titleBuffer)).replace(/\0/g, "").trim();
  const countBuffer = await file.slice(EPD_COUNT_OFFSET, EPD_COUNT_OFFSET + 4).arrayBuffer();
  const itemCount   = new DataView(countBuffer).getUint32(0, true);
  validateCount(itemCount);
  const tableSize   = itemCount * EPD_ENTRY_SIZE;
  if (EPD_TABLE_OFFSET + tableSize > file.size) throw new Error("EPD item table exceeds file size.");
  const tableBuffer = await file.slice(EPD_TABLE_OFFSET, EPD_TABLE_OFFSET + tableSize).arrayBuffer();
  const tableView   = new DataView(tableBuffer);
  const tableBytes8 = new Uint8Array(tableBuffer);
  const entries = [];
  for (let i = 0; i < itemCount; i++) {
    const base   = i * EPD_ENTRY_SIZE;
    const prefix = decodeNullTerminated(tableBytes8, base, EPD_PREFIX_SIZE);
    const suffix = decodeNullTerminated(tableBytes8, base + EPD_PREFIX_SIZE, EPD_SUFFIX_SIZE);
    const name   = decodeEpdEntryName(prefix, suffix, tableBytes8, base);
    const length     = tableView.getUint32(base + 64, true);
    const dataOffset = tableView.getUint32(base + 68, true);
    validateEntry(name, length, dataOffset, file.size);
    entries.push(makeEntry(name, length, dataOffset));
  }
  return { format: "EPD", comment, entries };
}

function decodeEpdEntryName(prefix, suffix, tableBytes8, base) {
  if (isLikelyPathPrefix(prefix) && suffix.startsWith("\\")) {
    return prefix + suffix;
  }
  if (suffix) return suffix;
  // Fallback: full 64-byte field
  return decodeNullTerminated(tableBytes8, base, 64);
}

function isLikelyPathPrefix(s) {
  return s.length > 0 && /^[A-Z0-9_]+$/.test(s);
}

function isPlausibleArchivePath(name) {
  return !/[\0-\x1f]/.test(name) && !name.includes(":") && name.length <= POD1_LONG_NAME_SIZE - 1;
}

// ─── Entry reading ────────────────────────────────────────────────────────────
export async function readPodEntryBytes(opfsPodPath, entry) {
  const file   = await readFile(opfsPodPath);
  const buffer = await file.slice(entry.offset, entry.offset + entry.length).arrayBuffer();
  return new Uint8Array(buffer);
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────
export function findEntry(podIndex, normalizedName) {
  const upper = normalizeArchiveName(normalizedName);
  return podIndex.entries.find((e) => e.normalizedName === upper) ?? null;
}

export function findEntryByTitle(podIndex, title) {
  const upper = archiveTitle(title);
  return podIndex.entries.find((e) => e.title === upper) ?? null;
}

export function findEntryFlexible(podIndex, name) {
  return findEntry(podIndex, name) ?? findEntryByTitle(podIndex, name);
}

export function findEntriesByExtension(podIndex, ext) {
  const upper = ext.toUpperCase();
  return podIndex.entries.filter((e) => e.title.endsWith(upper));
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function makeEntry(name, length, dataOffset, paletteName = null) {
  return {
    name,
    normalizedName: normalizeArchiveName(name),
    title: archiveTitle(name),
    length,
    offset: dataOffset,
    paletteName
  };
}

function validateCount(count, maximum = MAX_REASONABLE_ITEMS) {
  if (count < 1 || count > maximum) {
    throw new Error(`Suspicious archive item count: ${count}`);
  }
}

function validateEntry(name, length, offset, fileSize) {
  if (offset > fileSize || length > fileSize - offset) {
    throw new Error(`Archive entry exceeds file size: ${name}`);
  }
}

function decodeNullTerminated(bytes, offset, maxLen) {
  let end = offset;
  const limit = Math.min(offset + maxLen, bytes.length);
  while (end < limit && bytes[end] !== 0) end++;
  return trimPodString(decoder.decode(bytes.subarray(offset, end)));
}

function decodeNullTerminatedFromTable(bytes, offset) {
  if (offset >= bytes.length) return "";
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return trimPodString(decoder.decode(bytes.subarray(offset, end)));
}

function decodePod1NameField(bytes, offset, width) {
  const limit = Math.min(offset + width, bytes.length);
  let pathEnd = offset;
  while (pathEnd < limit && bytes[pathEnd] !== 0) pathEnd++;
  const pathTerminated = pathEnd < limit;
  const name = trimPodString(decoder.decode(bytes.subarray(offset, pathEnd)));
  let paletteName = null;
  if (name.toUpperCase().endsWith(".RAW") && pathEnd < limit - 1) {
    const paletteStart = pathEnd + 1;
    let paletteEnd = paletteStart;
    while (paletteEnd < limit && bytes[paletteEnd] !== 0) paletteEnd++;
    const candidate = trimPodString(decoder.decode(bytes.subarray(paletteStart, paletteEnd)));
    if (paletteEnd < limit && candidate.toUpperCase().endsWith(".ACT")) {
      paletteName = candidate;
    }
  }
  return { name, paletteName, pathTerminated };
}

function trimPodString(value) {
  return value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
}
