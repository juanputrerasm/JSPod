/*
  Validation, ported from KPod's PodArchiveValidator.

  validateDocument checks what Save would write: path safety, duplicate names, and whatever the
  output format's OpenPhotex writer refuses (name budget, comment length, entry count,
  windows-1252 text). An edit is refused only when it adds a problem the archive did not
  already have (see newErrors), so an archive that arrived with duplicate names can still be
  edited; Save then asks for them to be fixed.

  validateOpened checks an archive as read: unsafe paths, duplicates, malformed palette records
  and overlapping payloads. CRC checks need the bytes and run in the worker.
*/
import { buildPod1Directory, buildPod2Directory, PodWriteError } from "../vendor/openphotex/index.js";
import { pathProblem } from "./paths.js";

/**
 * @param {import("./pod-document.js").PodDocument} doc
 * @param {{forSave?: boolean}} [options] forSave adds the checks that only matter when writing (an empty archive)
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateDocument(doc, { forSave = false } = {}) {
  const errors = [];
  const warnings = [];
  if (doc.entries.length === 0) {
    if (forSave) errors.push("The archive is empty. Add files first.");
    return { errors, warnings };
  }
  const seen = new Map();
  for (const entry of doc.entries) {
    const problem = pathProblem(entry.name);
    if (problem) errors.push(problem);
    const first = seen.get(entry.normalizedName);
    if (first) errors.push(`Duplicate POD entry name: ${entry.name}`);
    else seen.set(entry.normalizedName, entry);
  }
  for (const folder of doc.folders) {
    const problem = pathProblem(folder);
    if (problem) errors.push(problem);
  }
  const writerError = layoutError(doc);
  if (writerError && writerError.code !== "DUPLICATE_NAME") errors.push(writerError.message);
  return { errors, warnings };
}

/** The first problem OpenPhotex's writer for the output format finds, or null. */
function layoutError(doc) {
  try {
    if (doc.outputFormat === "pod2") {
      buildPod2Directory(
        doc.commentForWrite(),
        doc.entries.map((e) => ({ name: e.name, length: e.length, timestamp: e.timestamp ?? 0, crc: 0 })),
        doc.outputAuditCount(),
      );
    } else {
      buildPod1Directory(
        doc.comment,
        doc.entries.map((e) => ({ name: e.name, length: e.length, paletteName: e.paletteName })),
      );
    }
    return null;
  } catch (error) {
    if (error instanceof PodWriteError) return error;
    if (error instanceof RangeError) return { code: "RANGE", message: error.message };
    throw error;
  }
}

/** Errors in `after` that `before` did not have. */
export function newErrors(before, after) {
  const known = new Map();
  for (const message of before.errors) known.set(message, (known.get(message) ?? 0) + 1);
  const added = [];
  for (const message of after.errors) {
    const left = known.get(message) ?? 0;
    if (left > 0) known.set(message, left - 1);
    else added.push(message);
  }
  return added;
}

/**
 * Checks an archive as read (OpenPhotex PodArchive). CRCs are checked separately.
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateOpened(podIndex) {
  const errors = [];
  const warnings = [];
  const names = new Set();
  for (const entry of podIndex.entries) {
    const problem = pathProblem(entry.name.replace(/\//g, "\\"));
    if (problem) errors.push(problem);
    if (names.has(entry.normalizedName)) errors.push(`Duplicate POD entry name: ${entry.name}`);
    names.add(entry.normalizedName);
    if (entry.paletteName && !entry.paletteName.toUpperCase().endsWith(".ACT")) {
      warnings.push(`Malformed embedded palette name for ${entry.name}: ${entry.paletteName}`);
    }
  }
  const byOffset = [...podIndex.entries].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < byOffset.length; i++) {
    const prev = byOffset[i - 1];
    if (prev.length > 0 && prev.offset + prev.length > byOffset[i].offset) {
      errors.push(`Overlapping POD entries: ${prev.name} and ${byOffset[i].name}`);
    }
  }
  return { errors, warnings };
}

/** Thrown by an edit that would add a validation error. */
export class EditRejected extends Error {
  constructor(errors) {
    super(errors.join("\n"));
    this.name = "EditRejected";
    this.errors = errors;
  }
}
