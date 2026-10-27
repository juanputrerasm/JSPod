/*
  Access to the user's own files.

  Chromium browsers have the File System Access API: real open/save pickers, save in place,
  folder pickers with write access, and handles that can be remembered for Recent files. Other
  browsers fall back to <input type=file>, webkitdirectory folder inputs, and downloads.
*/

export const hasFileSystemAccess = typeof window !== "undefined" && "showOpenFilePicker" in window;
export const hasDirectoryAccess = typeof window !== "undefined" && "showDirectoryPicker" in window;

const POD_TYPES = [{ description: "POD archives", accept: { "application/octet-stream": [".pod", ".epd", ".zip"] } }];

function isAbort(error) {
  return error?.name === "AbortError";
}

/** Shows a hidden <input type=file> and resolves with the chosen files ([] when cancelled). */
function inputPick({ accept = "", multiple = false, directory = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    if (directory) input.webkitdirectory = true;
    input.style.display = "none";
    document.body.appendChild(input);
    let done = false;
    const finish = (files) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish([...input.files]));
    input.addEventListener("cancel", () => finish([]));
    input.click();
  });
}

/** Picks a POD/EPD/ZIP. Resolves with {file, handle} (handle only where the API exists) or null. */
export async function pickArchive() {
  if (hasFileSystemAccess) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: POD_TYPES, excludeAcceptAllOption: false, id: "jspod-open" });
      return { file: await handle.getFile(), handle };
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  }
  const [file] = await inputPick({ accept: ".pod,.epd,.zip" });
  return file ? { file, handle: null } : null;
}

/** Picks one or more files to add. Resolves with File[] ([] when cancelled). */
export async function pickFiles({ multiple = true, accept = "" } = {}) {
  if (hasFileSystemAccess && !accept) {
    try {
      const handles = await window.showOpenFilePicker({ multiple, id: "jspod-add" });
      return Promise.all(handles.map((h) => h.getFile()));
    } catch (error) {
      if (isAbort(error)) return [];
      throw error;
    }
  }
  return inputPick({ multiple, accept });
}

/**
 * Picks a folder and lists every file in it. Paths start with the folder's own name, as KPod's
 * Add Folder stores them: "TRACK/ART/ROCK.RAW".
 * @returns {Promise<{file: File, path: string}[]|null>}
 */
export async function pickFolderFiles() {
  if (hasDirectoryAccess) {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: "jspod-folder" });
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
    const out = [];
    await walkDirectoryHandle(dir, dir.name, out);
    return out;
  }
  const files = await inputPick({ directory: true, multiple: true });
  if (!files.length) return null;
  return files.map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

async function walkDirectoryHandle(dir, prefix, out) {
  for await (const [name, handle] of dir.entries()) {
    const path = `${prefix}/${name}`;
    if (handle.kind === "directory") await walkDirectoryHandle(handle, path, out);
    else out.push({ file: await handle.getFile(), path });
  }
}

/**
 * Files dropped from the desktop, folders included (their paths keep the folder name).
 * @returns {Promise<{file: File, path: string}[]>}
 */
export async function droppedFiles(dataTransfer) {
  const items = [...(dataTransfer.items ?? [])].filter((i) => i.kind === "file");
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files].map((file) => ({ file, path: file.name }));
  const out = [];
  const walk = async (entry, prefix) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      out.push({ file: await new Promise((res, rej) => entry.file(res, rej)), path });
      return;
    }
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const child of batch) await walk(child, path);
    }
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}

/** A writable folder (Chromium only), or null when cancelled. */
export async function pickWritableDirectory(id = "jspod-extract") {
  if (!hasDirectoryAccess) return null;
  try {
    return await window.showDirectoryPicker({ id, mode: "readwrite" });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** Asks for write permission on a remembered handle. */
export async function ensureWritable(handle) {
  if (!handle?.queryPermission) return false;
  const options = { mode: "readwrite" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

/** Writes a Blob/File through a file handle. */
export async function writeToHandle(handle, blob) {
  const writable = await handle.createWritable();
  await blob.stream().pipeTo(writable);
}

/**
 * Asks where to save (Chromium) and writes there; elsewhere downloads under `suggestedName`.
 * @returns {Promise<{handle: FileSystemFileHandle|null, name: string}|null>} null when cancelled
 */
export async function saveBlobAs(blob, suggestedName, { description = "POD archive", extensions = [".pod"] } = {}) {
  if (hasFileSystemAccess && "showSaveFilePicker" in window) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName,
        id: "jspod-save",
        types: [{ description, accept: { "application/octet-stream": extensions } }],
      });
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
    await writeToHandle(handle, blob);
    return { handle, name: handle.name };
  }
  downloadBlob(blob, suggestedName);
  return { handle: null, name: suggestedName };
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Writes bytes to `path` ("A/B/C.RAW") under a directory handle, creating folders. */
export async function writeIntoDirectory(dir, path, bytes) {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  let current = dir;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
  const handle = await current.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

// ─── Recent files (IndexedDB; handles can only be stored where the API exists) ───

const DB_NAME = "jspod";
const STORE = "recent";
const MAX_RECENT = 10;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "name" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** @returns {Promise<{name: string, handle: FileSystemFileHandle, when: number}[]>} newest first */
export async function listRecent() {
  if (!hasFileSystemAccess) return [];
  try {
    const all = await withStore("readonly", (store) => store.getAll());
    return all.sort((a, b) => b.when - a.when).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export async function rememberRecent(handle) {
  if (!hasFileSystemAccess || !handle) return;
  try {
    await withStore("readwrite", (store) => store.put({ name: handle.name, handle, when: Date.now() }));
    const all = await listRecent();
    const stale = (await withStore("readonly", (store) => store.getAll())).sort((a, b) => b.when - a.when).slice(MAX_RECENT);
    if (stale.length) await withStore("readwrite", (store) => stale.forEach((r) => store.delete(r.name)));
    return all;
  } catch {
    // Recent files are a convenience; failing to store one is not an error worth showing.
  }
}

export async function forgetRecent(name) {
  try {
    await withStore("readwrite", (store) => store.delete(name));
  } catch {
    // ignore
  }
}
