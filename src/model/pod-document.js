/*
  The archive being edited.

  Entries are immutable objects: an edit replaces an entry with a new one, so anything keyed on
  the object (the byte cache, the selection) can never show stale data. Each entry says where
  its bytes live:

    { kind: "archive", path, offset, length }   a range of an archive staged in OPFS
    { kind: "blob", path }                      a whole OPFS file (added, replaced or edited data)

  The worker reads both (src/worker/pod-format.js readEntrySource), so previews work the same
  for saved and unsaved entries.

  Undo works on snapshots of the editable state. Snapshots are cheap: the arrays hold shared,
  immutable entries.
*/
import { podPathTitle } from "../vendor/openphotex/index.js";
import { entryKey, toEntryName } from "./paths.js";

let nextEntryId = 1;
let nextStateId = 1;

/**
 * A new immutable entry.
 * @param {{name: string, length: number, source: object, timestamp?: number|null,
 *          paletteName?: string|null, crc?: number|null}} fields
 */
export function makeEntry(fields) {
  const name = toEntryName(fields.name);
  return Object.freeze({
    id: nextEntryId++,
    name,
    normalizedName: entryKey(name),
    title: podPathTitle(name),
    length: fields.length,
    // Kept for the previews and the metadata panel: the payload's offset in the archive it was
    // read from, or null for data that is not in a saved archive yet.
    offset: fields.source?.kind === "archive" ? fields.source.offset : null,
    timestamp: fields.timestamp ?? null,
    paletteName: fields.paletteName ?? null,
    crc: fields.crc ?? null,
    source: Object.freeze({ ...fields.source }),
  });
}

/** The same entry under a new name: same payload, palette record and timestamp. */
export function renamedEntry(entry, name) {
  return makeEntry({ ...entry, name });
}

export class PodDocument {
  /**
   * @param {object} init
   * @param {"pod1"|"pod2"|"epd"|null} [init.format] the format the archive was read as; null for a new one
   * @param {string} [init.comment]
   * @param {Uint8Array|null} [init.rawComment] the comment field as read, written back unchanged when the comment is
   * @param {object[]} [init.entries] entries made with makeEntry
   * @param {{path: string, offset: number, length: number, count: number}|null} [init.auditTrail] the existing POD2 trail
   * @param {string} [init.sourceName]
   * @param {number} [init.byteLength]
   */
  constructor(init = {}) {
    this.format = init.format ?? null;
    /** The format Save writes: POD2 stays POD2, everything else becomes POD1 unless chosen otherwise. */
    this.outputFormat = this.format === "pod2" ? "pod2" : "pod1";
    this.comment = init.comment ?? "";
    this.originalComment = this.comment;
    this.rawComment = init.rawComment ?? null;
    this.entries = (init.entries ?? []).slice();
    /** Explicit folders: empty folders the user created, in entry-name form. */
    this.folders = new Set();
    this.auditTrail = init.auditTrail ?? null;
    /** Audit records added in this session, as OpenPhotex encodePod2AuditRecord takes them. */
    this.auditAdded = [];
    this.auditEnabled = true;
    this.auditAuthor = init.auditAuthor ?? "jspod";
    this.sourceName = init.sourceName ?? "untitled.pod";
    this.byteLength = init.byteLength ?? 0;
    this.stateId = nextStateId++;
    this.savedStateId = this.stateId;
    /** Seconds since the epoch; replaceable in tests. */
    this.now = () => Math.floor(Date.now() / 1000);
  }

  /**
   * Unsaved edits, or a POD1/POD2 that Save would now write in the other format. An EPD always
   * saves as a conversion, so viewing one does not count as a change.
   */
  get dirty() {
    if (this.stateId !== this.savedStateId) return true;
    return (this.format === "pod1" || this.format === "pod2") && this.outputFormat !== this.format;
  }

  markSaved() {
    this.savedStateId = this.stateId;
  }

  /** Call after every change to the editable state. */
  touch() {
    this.stateId = nextStateId++;
  }

  snapshot() {
    return {
      stateId: this.stateId,
      entries: this.entries.slice(),
      folders: new Set(this.folders),
      comment: this.comment,
      auditAdded: this.auditAdded.slice(),
    };
  }

  restore(snapshot) {
    this.stateId = snapshot.stateId;
    this.entries = snapshot.entries.slice();
    this.folders = new Set(snapshot.folders);
    this.comment = snapshot.comment;
    this.auditAdded = snapshot.auditAdded.slice();
  }

  entryById(id) {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  indexOfKey(name) {
    const key = entryKey(name);
    return this.entries.findIndex((e) => e.normalizedName === key);
  }

  /** Records an audit entry when auditing is on. Saved only when the output is POD2. */
  audit(action, path, oldTimestamp, oldSize, newTimestamp, newSize) {
    if (!this.auditEnabled) return;
    this.auditAdded.push({
      user: this.auditAuthor.slice(0, 31),
      timestamp: this.now(),
      action,
      path,
      oldTimestamp: oldTimestamp ?? 0,
      oldSize: oldSize ?? 0,
      newTimestamp: newTimestamp ?? 0,
      newSize: newSize ?? 0,
    });
  }

  /** Projected size of the archive Save would write, in bytes. */
  projectedSize() {
    const payloads = this.entries.reduce((sum, e) => sum + e.length, 0);
    if (this.outputFormat === "pod2") {
      const names = this.entries.reduce((sum, e) => sum + e.name.length + 1, 0);
      const audit = this.outputAuditCount() * 312;
      return 0x60 + this.entries.length * 20 + names + payloads + audit;
    }
    return 84 + this.entries.length * 40 + payloads;
  }

  outputAuditCount() {
    if (this.outputFormat !== "pod2") return 0;
    return (this.auditTrail?.count ?? 0) + this.auditAdded.length;
  }

  /**
   * The comment for the writer: the raw field when the comment is unchanged (so trailing bytes
   * the reader trims survive), the text otherwise.
   */
  commentForWrite() {
    return this.rawComment && this.comment === this.originalComment ? this.rawComment : this.comment;
  }
}

/**
 * A document for an archive staged at `path` in OPFS.
 * @param {object} podIndex the parsed archive (OpenPhotex PodArchive, format in lower case)
 */
export function documentFromArchive(podIndex, { path, sourceName, rawComment = null }) {
  const format = String(podIndex.format).toLowerCase();
  const entries = podIndex.entries.map((e) => makeEntry({
    name: e.name,
    length: e.length,
    timestamp: e.timestamp,
    paletteName: e.paletteName,
    crc: e.crc,
    source: { kind: "archive", path, offset: e.offset, length: e.length },
  }));
  let auditTrail = null;
  if (format === "pod2" && podIndex.auditCount > 0) {
    const length = podIndex.auditCount * 312;
    auditTrail = { path, offset: podIndex.byteLength - length, length, count: podIndex.auditCount };
  }
  return new PodDocument({
    format,
    comment: podIndex.comment ?? "",
    rawComment,
    entries,
    auditTrail,
    sourceName,
    byteLength: podIndex.byteLength,
  });
}
