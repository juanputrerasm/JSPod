/*
  Entry path rules shared by every edit.

  Archives store paths with "\" separators. The rules follow KPod's PodArchiveWriter
  (NormalizeName, ValidatePath); OpenPhotex's writers apply the byte-level rules (name budget,
  windows-1252) when the archive is built.
*/
import { normalizePodPath } from "../vendor/openphotex/index.js";

/** "a/b\\c" -> "a\\b\\c", trimmed. */
export function toEntryName(path) {
  return String(path ?? "").replace(/\//g, "\\").trim();
}

/** Case- and separator-insensitive comparison key. */
export function entryKey(path) {
  return normalizePodPath(String(path ?? ""));
}

/** Returns an error message for an unsafe path, or null when it is usable. */
export function pathProblem(name) {
  const path = String(name ?? "");
  if (!path.trim() || path.startsWith("\\") || path.endsWith("\\") || path.includes(":") || path.includes("\0")) {
    return `Unsafe POD entry path: ${path}`;
  }
  for (const part of path.split("\\")) {
    if (part.length === 0 || part === "." || part === ".." || /[\x00-\x1f]/.test(part)) {
      return `Unsafe POD entry path: ${path}`;
    }
  }
  return null;
}

/** The last path segment. */
export function baseName(path) {
  const name = toEntryName(path);
  const slash = name.lastIndexOf("\\");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

/** Everything before the last segment, "" for a root entry. */
export function parentPath(path) {
  const name = toEntryName(path);
  const slash = name.lastIndexOf("\\");
  return slash >= 0 ? name.slice(0, slash) : "";
}

export function joinEntry(folder, name) {
  const f = toEntryName(folder);
  const n = toEntryName(name);
  return f ? `${f}\\${n}` : n;
}

/** True when `path` lies inside `folder` (any depth), ignoring case. */
export function isInside(path, folder) {
  const f = entryKey(folder);
  return f !== "" && entryKey(path).startsWith(f + "/");
}

/** Every ancestor folder of a path, outermost first: "A\\B\\C.X" -> ["A", "A\\B"]. */
export function ancestorFolders(path) {
  const parts = toEntryName(path).split("\\");
  const out = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("\\"));
  return out;
}
