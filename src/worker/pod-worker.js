import { indexPodFile, readPodEntryBytes } from "./pod-format.js";
import { decodeBinModel } from "./bin-decoder.js";
import { decodeRawTexture, decodeActPalette } from "./texture-decoder.js";

const handlers = {
  async indexPod({ opfsPodPath }) {
    return indexPodFile(opfsPodPath);
  },

  async readEntryBytes({ opfsPodPath, entry }) {
    const bytes = await readPodEntryBytes(opfsPodPath, entry);
    return { bytes };
  },

  async decodeBin({ bytes, name, origin }) {
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const model = decodeBinModel(uint8, name, origin);
    // Transfer Float32Arrays for zero-copy
    const transfers = [];
    for (const mesh of model.meshes ?? []) {
      if (mesh.positions) transfers.push(mesh.positions.buffer);
      if (mesh.normals)   transfers.push(mesh.normals.buffer);
      if (mesh.uvs)       transfers.push(mesh.uvs.buffer);
    }
    return [model, transfers];
  },

  async decodeRaw({ rawBytes, actBytes, name, width, height }) {
    const raw = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    const act = actBytes ? (actBytes instanceof Uint8Array ? actBytes : new Uint8Array(actBytes)) : null;
    const result = decodeRawTexture(raw, act, name, width, height);
    return [result, [result.rgba.buffer]];
  },

  async decodeAct({ actBytes }) {
    const bytes = actBytes instanceof Uint8Array ? actBytes : new Uint8Array(actBytes);
    const palette = decodeActPalette(bytes);
    return palette ? [{ palette }, [palette.buffer]] : [{ palette: null }, []];
  }
};

self.addEventListener("message", async (event) => {
  const { id, type, payload } = event.data;
  try {
    const handler = handlers[type];
    if (!handler) throw new Error(`Unknown worker message type: ${type}`);
    const result = await handler(payload ?? {});
    if (Array.isArray(result)) {
      const [data, transfers] = result;
      self.postMessage({ id, ok: true, payload: data }, transfers);
    } else {
      self.postMessage({ id, ok: true, payload: result });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
});
