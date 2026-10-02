import { indexPodFile, readPodEntryBytes } from "./pod-format.js";
import { decodeBinModel } from "./bin-decoder.js";
import { decodeSmfModel } from "./smf-decoder.js";
import { decodeCprCmdModel } from "./cmd-decoder.js";
import { decodeRawTexture, decodeActPalette, applyOpacityPlane } from "./texture-decoder.js";
import { decodeTrueColorTexture } from "./image-decoder.js";
import { decodeTiffTexture } from "./tiff-decoder.js";
import { decodeDfmModel, decodeDfmMotionModel, decodeKfmModel, inspectDfm } from "./nocturne-decoder.js";

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

  async decodeSmf({ bytes, name }) {
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const model = decodeSmfModel(uint8, name);
    const transfers = [];
    for (const mesh of model.meshes ?? []) {
      if (mesh.positions) transfers.push(mesh.positions.buffer);
      if (mesh.normals)   transfers.push(mesh.normals.buffer);
      if (mesh.uvs)       transfers.push(mesh.uvs.buffer);
    }
    return [model, transfers];
  },

  async decodeCmd({ bytes, name }) {
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const model = decodeCprCmdModel(new TextDecoder("windows-1252").decode(uint8), name);
    const transfers = [];
    for (const mesh of model.meshes ?? []) {
      if (mesh.positions) transfers.push(mesh.positions.buffer);
      if (mesh.normals)   transfers.push(mesh.normals.buffer);
      if (mesh.uvs)       transfers.push(mesh.uvs.buffer);
    }
    return [model, transfers];
  },

  async decodeKfm({ bytes, name, frameIndex }) {
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const model = decodeKfmModel(uint8, name, { frameIndex });
    const transfers = [];
    for (const mesh of model.meshes ?? []) {
      transfers.push(mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer);
    }
    return [model, transfers];
  },

  async inspectDfm({ bytes, name }) {
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return inspectDfm(uint8, name);
  },

  async decodeDfm({ bytes, skeletonBytes, name, lodIndex, frameIndex }) {
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const skeleton = skeletonBytes ? (skeletonBytes instanceof Uint8Array ? skeletonBytes : new Uint8Array(skeletonBytes)) : null;
    const model = decodeDfmModel(uint8, skeleton, name, { lodIndex, frameIndex });
    const transfers = [];
    for (const mesh of model.meshes ?? []) transfers.push(mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer);
    return [model, transfers];
  },

  async decodeDfmMotion({ bytes, skeletonBytes, name, lodIndex, motionIndex, frameIndex }) {
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const skeleton = skeletonBytes ? (skeletonBytes instanceof Uint8Array ? skeletonBytes : new Uint8Array(skeletonBytes)) : null;
    const model = decodeDfmMotionModel(uint8, skeleton, name, { lodIndex, motionIndex, frameIndex });
    const transfers = new Set();
    for (const mesh of model.meshes ?? []) {
      transfers.add(mesh.positions.buffer);
      transfers.add(mesh.normals.buffer);
      transfers.add(mesh.uvs.buffer);
    }
    for (const frame of model.keyframes ?? []) {
      for (const mesh of frame.meshes ?? []) {
        transfers.add(mesh.positions.buffer);
        transfers.add(mesh.normals.buffer);
      }
    }
    return [model, [...transfers]];
  },

  async decodeRaw({ rawBytes, actBytes, opaBytes, name, width, height }) {
    const raw = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    const act = actBytes ? (actBytes instanceof Uint8Array ? actBytes : new Uint8Array(actBytes)) : null;
    const opa = opaBytes ? (opaBytes instanceof Uint8Array ? opaBytes : new Uint8Array(opaBytes)) : null;
    const result = applyOpacityPlane(decodeRawTexture(raw, act, name, width, height), opa);
    return [result, [result.rgba.buffer]];
  },

  async decodeTiff({ bytes, name }) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const result = decodeTiffTexture(source, name);
    return [result, [result.rgba.buffer]];
  },

  async decodeImage({ bytes, name, format }) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const result = await decodeTrueColorTexture(source, name, format);
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
