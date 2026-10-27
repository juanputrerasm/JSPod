/*
  Archive edits. Each one mutates a PodDocument in place and records the POD2 audit entries
  KPod records for the same action; run them through History.run so they can be undone and are
  validated. Behaviour follows KPod's MainForm:

  - Adding a name that exists replaces that entry only when `replace(name)` agrees.
  - A rename or move is logged as a remove plus an add.
  - Replace keeps the entry's name and palette record.
*/
import { makeEntry, renamedEntry } from "./pod-document.js";
import { disabledName, enabledName } from "./disable.js";
import { baseName, entryKey, isInside, joinEntry, parentPath, pathProblem, toEntryName } from "./paths.js";

/**
 * Adds entries at the end of the archive, or replaces same-name entries in place.
 * @param {{name: string, length: number, source: object, timestamp?: number}[]} items
 * @param {{replace?: (name: string) => boolean}} [options] asked for each name that exists
 * @returns {{added: number, replaced: number, skipped: number, entries: object[]}} or false when nothing changed
 */
export function addEntries(doc, items, { replace = () => false } = {}) {
  const result = { added: 0, replaced: 0, skipped: 0, entries: [] };
  for (const item of items) {
    const name = toEntryName(item.name);
    const problem = pathProblem(name);
    if (problem) throw new Error(problem);
    const entry = makeEntry({ name, length: item.length, timestamp: item.timestamp ?? null, source: item.source });
    const existing = doc.indexOfKey(name);
    if (existing >= 0) {
      if (!replace(doc.entries[existing].name)) { result.skipped++; continue; }
      const old = doc.entries[existing];
      doc.entries[existing] = entry;
      doc.audit("change", name, old.timestamp, old.length, entry.timestamp, entry.length);
      result.replaced++;
    } else {
      doc.entries.push(entry);
      doc.audit("add", name, 0, 0, entry.timestamp, entry.length);
      result.added++;
    }
    result.entries.push(entry);
  }
  return result.added + result.replaced > 0 ? result : false;
}

/** Removes entries by id, and folders with everything inside them. Returns the count removed. */
export function removeEntries(doc, ids, folders = []) {
  const idSet = new Set(ids);
  const keep = [];
  let removed = 0;
  for (const entry of doc.entries) {
    if (idSet.has(entry.id) || folders.some((f) => isInside(entry.name, f))) {
      doc.audit("remove", entry.name, entry.timestamp, entry.length, 0, 0);
      removed++;
    } else {
      keep.push(entry);
    }
  }
  let foldersRemoved = 0;
  for (const folder of [...doc.folders]) {
    if (folders.some((f) => entryKey(f) === entryKey(folder) || isInside(folder, f))) {
      doc.folders.delete(folder);
      foldersRemoved++;
    }
  }
  if (removed + foldersRemoved === 0) return false;
  doc.entries = keep;
  return removed;
}

/** Swaps an entry's payload, keeping its name and palette record. */
export function replaceEntry(doc, id, { length, source, timestamp = null }) {
  const index = doc.entries.findIndex((e) => e.id === id);
  if (index < 0) throw new Error("The entry no longer exists.");
  const old = doc.entries[index];
  const entry = makeEntry({ name: old.name, paletteName: old.paletteName, length, timestamp, source });
  doc.entries[index] = entry;
  doc.audit("change", old.name, old.timestamp, old.length, entry.timestamp, entry.length);
  return entry;
}

/** Renames one entry in place. `newBase` is a single name, not a path. */
export function renameEntry(doc, id, newBase) {
  const name = checkedBase(newBase);
  const index = doc.entries.findIndex((e) => e.id === id);
  if (index < 0) throw new Error("The entry no longer exists.");
  const old = doc.entries[index];
  const target = joinEntry(parentPath(old.name), name);
  if (target === old.name) return false;
  return applyRenames(doc, [[index, target]])[0];
}

/** Renames a folder: every entry and explicit folder under it moves with it. */
export function renameFolder(doc, folder, newBase) {
  const name = checkedBase(newBase);
  const from = toEntryName(folder);
  const to = joinEntry(parentPath(from), name);
  if (to === from) return false;
  const renames = [];
  doc.entries.forEach((entry, index) => {
    if (isInside(entry.name, from)) renames.push([index, to + entry.name.slice(from.length)]);
  });
  renameExplicitFolders(doc, from, to);
  applyRenames(doc, renames);
  return renames.length;
}

/**
 * Moves entries and folders into `destination` ("" for the root). A moved folder keeps its own
 * name under the destination. A folder cannot move into itself.
 */
export function moveEntries(doc, ids, folders, destination) {
  const dest = toEntryName(destination);
  for (const folder of folders) {
    const f = toEntryName(folder);
    if (entryKey(dest) === entryKey(f) || isInside(dest, f)) throw new Error("A folder cannot be moved into itself.");
  }
  const idSet = new Set(ids);
  const renames = [];
  doc.entries.forEach((entry, index) => {
    const folder = folders.find((f) => isInside(entry.name, f));
    let target;
    if (folder) {
      const f = toEntryName(folder);
      target = joinEntry(dest, baseName(f)) + entry.name.slice(f.length);
    } else if (idSet.has(entry.id)) {
      target = joinEntry(dest, baseName(entry.name));
    } else {
      return;
    }
    if (target !== entry.name) renames.push([index, target]);
  });
  for (const folder of folders) {
    const f = toEntryName(folder);
    renameExplicitFolders(doc, f, joinEntry(dest, baseName(f)));
  }
  if (renames.length === 0) return false;
  applyRenames(doc, renames);
  return renames.length;
}

/** Adds an empty folder that is kept until it is removed or filled. */
export function createFolder(doc, parent, name) {
  const path = joinEntry(parent, checkedBase(name));
  const problem = pathProblem(path);
  if (problem) throw new Error(problem);
  const key = entryKey(path);
  if ([...doc.folders].some((f) => entryKey(f) === key) || doc.entries.some((e) => isInside(e.name, path))) {
    throw new Error(`The folder ${path} already exists.`);
  }
  doc.folders.add(path);
  return path;
}

/** Disables (true) or enables (false) tracks and trucks among `ids`. Returns how many changed. */
export function setDisabled(doc, ids, disable) {
  const idSet = new Set(ids);
  const renames = [];
  doc.entries.forEach((entry, index) => {
    if (!idSet.has(entry.id)) return;
    const target = disable ? disabledName(entry.name) : enabledName(entry.name);
    if (target) renames.push([index, target]);
  });
  if (renames.length === 0) return false;
  applyRenames(doc, renames);
  return renames.length;
}

export function setComment(doc, comment) {
  if (comment === doc.comment) return false;
  doc.comment = comment;
  return true;
}

function applyRenames(doc, renames) {
  const out = [];
  for (const [index, target] of renames) {
    const old = doc.entries[index];
    const entry = renamedEntry(old, target);
    doc.entries[index] = entry;
    doc.audit("remove", old.name, old.timestamp, old.length, 0, 0);
    doc.audit("add", entry.name, 0, 0, old.timestamp, old.length);
    out.push(entry);
  }
  return out;
}

function renameExplicitFolders(doc, from, to) {
  for (const folder of [...doc.folders]) {
    if (entryKey(folder) === entryKey(from)) {
      doc.folders.delete(folder);
      doc.folders.add(to);
    } else if (isInside(folder, from)) {
      doc.folders.delete(folder);
      doc.folders.add(to + folder.slice(from.length));
    }
  }
}

function checkedBase(value) {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("Enter a name.");
  if (/[\\/]/.test(name)) throw new Error("Enter one file or folder name, not a path.");
  return name;
}
