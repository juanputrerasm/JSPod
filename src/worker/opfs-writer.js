/*
  Positional OPFS writes from the worker.

  A synchronous access handle is the fastest path and the only write path Safari offers in a
  worker; createWritable is the fallback for browsers without it.
*/
import { getFileHandle } from "../shared/opfs.js";

/** @returns {Promise<{write(bytes: Uint8Array, at: number): Promise<void>, close(): Promise<void>}>} */
export async function openFileWriter(path) {
  const handle = await getFileHandle(path, true);
  if (typeof handle.createSyncAccessHandle === "function") {
    const sync = await handle.createSyncAccessHandle();
    sync.truncate(0);
    return {
      async write(bytes, at) {
        let done = 0;
        while (done < bytes.length) done += sync.write(bytes.subarray(done), { at: at + done });
      },
      async close() {
        sync.flush();
        sync.close();
      },
    };
  }
  const writable = await handle.createWritable({ keepExistingData: false });
  return {
    async write(bytes, at) {
      await writable.write({ type: "write", position: at, data: bytes });
    },
    async close() {
      await writable.close();
    },
  };
}

/** Copies a File or Blob into OPFS in chunks, without holding it all in memory. */
export async function writeBlobToFile(path, blob, chunkSize = 4 << 20) {
  const writer = await openFileWriter(path);
  try {
    for (let at = 0; at < blob.size; at += chunkSize) {
      const chunk = new Uint8Array(await blob.slice(at, Math.min(blob.size, at + chunkSize)).arrayBuffer());
      await writer.write(chunk, at);
    }
  } finally {
    await writer.close();
  }
}
