/*
  Choosing where Save As writes, before the archive is built: the save picker needs the click
  that started it (user activation), which a long write would outlast.
*/
import { hasFileSystemAccess } from "./disk.js";

/**
 * @returns {Promise<FileSystemFileHandle|null|undefined>} a handle; null when the user cancelled;
 *   undefined when the browser has no save picker (the caller downloads instead)
 */
export async function pickSaveHandle(suggestedName) {
  if (!hasFileSystemAccess || !("showSaveFilePicker" in window)) return undefined;
  try {
    return await window.showSaveFilePicker({
      suggestedName,
      id: "jspod-save",
      types: [{ description: "POD archive", accept: { "application/octet-stream": [".pod"] } }],
    });
  } catch (error) {
    if (error?.name === "AbortError") return null;
    throw error;
  }
}
