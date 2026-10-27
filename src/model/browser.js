/*
  The rows of the entry list: a folder tree built from the entry paths plus the explicit empty
  folders, flattened for display. Port of KPod's EntryBrowser:

  - Folders come before files at every level.
  - Sorting cycles ascending, descending, then archive order, per column.
  - The quick filter is a case-insensitive substring match on the full path. While it is set,
    collapsed folders are ignored so every match shows.
*/
import { getRawDescription } from "../file-type-info.js";
import { ancestorFolders, baseName, entryKey } from "./paths.js";

/** The next sort state when a column header is clicked. */
export function cycleSort(sort, column) {
  if (!sort || sort.column !== column) return { column, dir: "asc" };
  if (sort.dir === "asc") return { column, dir: "desc" };
  return null;
}

export function describeEntry(entry) {
  return getRawDescription(entry.title, entry.length);
}

/** Every folder key in the document, for "collapse all". */
export function allFolderKeys(doc) {
  const keys = new Set();
  for (const entry of doc.entries) for (const f of ancestorFolders(entry.name)) keys.add(entryKey(f));
  for (const folder of doc.folders) {
    keys.add(entryKey(folder));
    for (const f of ancestorFolders(folder)) keys.add(entryKey(f));
  }
  return keys;
}

/**
 * @param {import("./pod-document.js").PodDocument} doc
 * @param {{collapsed?: Set<string>, filter?: string, sort?: {column: "name"|"size"|"description", dir: "asc"|"desc"}|null}} view
 * @returns {Array<{kind: "folder", key: string, path: string, label: string, depth: number, count: number, size: number, collapsed: boolean}
 *               | {kind: "file", entry: object, depth: number, order: number}>}
 */
export function buildRows(doc, { collapsed = new Set(), filter = "", sort = null } = {}) {
  const term = filter.trim().toUpperCase();
  const root = newFolder("", "", "");
  const folderFor = (path) => {
    let node = root;
    for (const ancestor of [...ancestorFolders(path + "\\x")]) {
      const key = entryKey(ancestor);
      let child = node.folders.get(key);
      if (!child) {
        child = newFolder(key, ancestor, baseName(ancestor));
        node.folders.set(key, child);
      }
      node = child;
    }
    return node;
  };

  doc.entries.forEach((entry, order) => {
    if (term && !entry.name.toUpperCase().includes(term) && !entry.normalizedName.includes(term)) return;
    const parent = entry.name.includes("\\") ? folderFor(entry.name.slice(0, entry.name.lastIndexOf("\\"))) : root;
    parent.files.push({ entry, order });
  });
  for (const folder of doc.folders) {
    if (term && !folder.toUpperCase().includes(term)) continue;
    folderFor(folder);
  }

  totals(root);
  const rows = [];
  flatten(root, 0, rows, term ? new Set() : collapsed, sort);
  return rows;
}

function newFolder(key, path, label) {
  return { key, path, label, folders: new Map(), files: [], count: 0, size: 0 };
}

function totals(node) {
  node.count = node.files.length;
  node.size = node.files.reduce((sum, f) => sum + f.entry.length, 0);
  for (const child of node.folders.values()) {
    totals(child);
    node.count += child.count;
    node.size += child.size;
  }
}

function flatten(node, depth, rows, collapsed, sort) {
  const folders = [...node.folders.values()];
  const files = node.files.slice();
  if (sort) {
    const sign = sort.dir === "desc" ? -1 : 1;
    const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
    if (sort.column === "size") {
      folders.sort((a, b) => sign * (a.size - b.size) || byName(a.label, b.label));
      files.sort((a, b) => sign * (a.entry.length - b.entry.length) || a.order - b.order);
    } else if (sort.column === "description") {
      folders.sort((a, b) => sign * byName(a.label, b.label));
      files.sort((a, b) => sign * byName(describeEntry(a.entry), describeEntry(b.entry)) || a.order - b.order);
    } else {
      folders.sort((a, b) => sign * byName(a.label, b.label));
      files.sort((a, b) => sign * byName(a.entry.title, b.entry.title) || a.order - b.order);
    }
  }
  for (const folder of folders) {
    const isCollapsed = collapsed.has(folder.key);
    rows.push({ kind: "folder", key: folder.key, path: folder.path, label: folder.label, depth, count: folder.count, size: folder.size, collapsed: isCollapsed });
    if (!isCollapsed) flatten(folder, depth + 1, rows, collapsed, sort);
  }
  for (const { entry, order } of files) rows.push({ kind: "file", entry, depth, order });
}
