/*
  Writing an archive into OPFS.

  The layouts and CRCs are OpenPhotex's (buildPod1Directory, buildPod2Directory,
  encodePod2AuditRecord, crc32Mpeg2Update); this file only streams the payloads in order from
  wherever each entry's bytes live (src/model/pod-document.js), so an archive of any size is
  written in bounded memory.

  POD2 needs every entry CRC in the directory, which comes first, so its payloads are read
  twice: once for the CRCs, once to write them. The archive CRC covers 0x08 to EOF and is
  computed while writing, then patched in at 0x04.
*/
import {
  buildPod1Directory, buildPod2Directory, encodePod2AuditRecord, crc32Mpeg2Update, CRC32_MPEG2_INIT,
  POD2_CHECKSUM_OFFSET, POD2_CHECKSUM_START,
} from "../vendor/openphotex/index.js";
import { readFile } from "../shared/opfs.js";
import { openFileWriter } from "./opfs-writer.js";

const CHUNK = 4 << 20;

/**
 * @param {object} job
 * @param {string} job.outPath OPFS path to write
 * @param {"pod1"|"pod2"} job.format
 * @param {string} job.comment the comment text
 * @param {Uint8Array|null} job.rawComment the raw 80-byte field to keep (POD2 only)
 * @param {{name: string, length: number, timestamp: number|null, paletteName: string|null, source: object}[]} job.entries
 * @param {{path: string, offset: number, length: number, count: number}|null} job.auditTrail existing POD2 trail to copy
 * @param {object[]} job.auditAdded new audit records
 * @param {number} job.now save time, Unix seconds, for entries without a timestamp
 * @param {(message: string) => void} [progress]
 * @param {{readFile: (path: string) => Promise<Blob>, openFileWriter: typeof openFileWriter}} [io] file access, replaceable in tests
 * @returns {Promise<{byteLength: number}>}
 */
export async function writeArchive(job, progress = () => {}, io = { readFile, openFileWriter }) {
  const files = new Map();
  const fileFor = async (path) => {
    if (!files.has(path)) files.set(path, await io.readFile(path));
    return files.get(path);
  };
  const chunksOf = async function* (source, length) {
    const file = await fileFor(source.path);
    const start = source.kind === "archive" ? source.offset : 0;
    if (source.kind === "blob" && file.size !== length) {
      throw new Error(`Staged data for an entry is ${file.size} bytes, expected ${length}.`);
    }
    for (let at = 0; at < length; at += CHUNK) {
      const end = Math.min(length, at + CHUNK);
      yield new Uint8Array(await file.slice(start + at, start + end).arrayBuffer());
    }
  };

  const { entries } = job;
  let directory;
  let trailParts = [];
  if (job.format === "pod2") {
    const crcs = [];
    for (let i = 0; i < entries.length; i++) {
      if (i % 64 === 0) progress(`Checksumming ${i + 1} of ${entries.length}...`);
      let crc = CRC32_MPEG2_INIT;
      for await (const chunk of chunksOf(entries[i].source, entries[i].length)) crc = crc32Mpeg2Update(crc, chunk);
      crcs.push(crc);
    }
    if (job.auditTrail) {
      const file = await fileFor(job.auditTrail.path);
      trailParts.push(new Uint8Array(await file.slice(job.auditTrail.offset, job.auditTrail.offset + job.auditTrail.length).arrayBuffer()));
    }
    for (const record of job.auditAdded ?? []) trailParts.push(encodePod2AuditRecord(record));
    const auditCount = trailParts.reduce((n, p) => n + p.length, 0) / 312;
    directory = buildPod2Directory(
      job.rawComment ?? job.comment,
      entries.map((e, i) => ({ name: e.name, length: e.length, timestamp: e.timestamp ?? job.now, crc: crcs[i] })),
      auditCount,
    );
  } else {
    directory = buildPod1Directory(job.comment, entries.map((e) => ({ name: e.name, length: e.length, paletteName: e.paletteName })));
  }

  const writer = await io.openFileWriter(job.outPath);
  let at = 0;
  let crc = CRC32_MPEG2_INIT;
  const emit = async (bytes) => {
    await writer.write(bytes, at);
    if (job.format === "pod2") crc = crc32Mpeg2Update(crc, at >= POD2_CHECKSUM_START ? bytes : bytes.subarray(POD2_CHECKSUM_START - at));
    at += bytes.length;
  };
  try {
    await emit(directory);
    for (let i = 0; i < entries.length; i++) {
      if (i % 64 === 0) progress(`Writing ${i + 1} of ${entries.length}...`);
      for await (const chunk of chunksOf(entries[i].source, entries[i].length)) await emit(chunk);
    }
    for (const part of trailParts) await emit(part);
    if (job.format === "pod2") {
      const slot = new Uint8Array(4);
      new DataView(slot.buffer).setUint32(0, crc, true);
      await writer.write(slot, POD2_CHECKSUM_OFFSET);
    }
  } finally {
    await writer.close();
  }
  return { byteLength: at };
}
