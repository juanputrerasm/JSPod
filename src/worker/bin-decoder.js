/*
  .BIN models for JSPod's model viewer.

  Parsing is OpenPhotex's (src/vendor/openphotex): parseBin walks the MRGL record stream the way
  the engine strides it and returns the model as the file states it, raw vertex words and faces
  with the texture, colour and material in force when each was read. This file keeps the
  viewer's own half: scaling to its model units, batching faces into meshes, triangulating and
  shading them.

  Geometry divisors (BIN_GEOMETRY_DIVISOR): editor units per vertex =
  (raw >> 1) * 65536 / (magnify * divisor), with 64 for MTM and CPR, 4096 for Hellbender and
  8192 for Terminal Velocity and Fury3; OpenPhotex's docs/BIN.md gives the evidence.
  JSPod used 10922.667 for Terminal Velocity and Fury3 until now, which drew those models at 75%
  of their width; the preview's proportions were unaffected, since every axis scaled alike.
*/
import { BIN_GEOMETRY_DIVISOR, MRGL, MRGLMAT, MRGLMAT2, parseBin } from "../vendor/openphotex/index.js";

const UV_SCALE = 0xff0000;
const TRANSPARENT_FACE_TYPES = new Set([0x11, 0x33]);
const MRGLMAT_BLEND = MRGLMAT.BLEND;
const MRGLMAT_ALPHATEST = MRGLMAT.ALPHATEST;
const MRGLMAT_TEXSOLID = MRGLMAT.TEXSOLID;

/*
  An ANIMATED_BIN names its frame models and carries no geometry (all 53 stock ones): after the
  frame count and magnify word come a zero vertex count and MRGL_EOL. This viewer has always run
  that empty payload through the geometry path too, so the model keeps the same empty fields.
*/
const EMPTY_PAYLOAD = { vertexListValid: true, vertices: new Int32Array(0), faces: [], materials: [], materials2: [], magnifyRecords: [], warnings: [], stopReason: null };

export function decodeBinModel(bytes, modelName, origin) {
  const model = {
    name: modelName, format: "UNKNOWN",
    magnifyPower: 65536, baseZ: 0,
    vertexCount: 0, polygonCount: 0,
    rawVertexBounds: null,
    textureNames: [], meshes: [], warnings: [], frameNames: []
  };
  if (!bytes?.length || bytes.length < 4) return model;
  const bin = parseBin(bytes);
  if (bin.kind === "lwo") { model.format = "LWO"; return model; }
  if (bin.kind === "mrgl") {
    model.format = "BIN";
    if (bin.magnify === null) return model;
    if (bin.magnify > 0) model.magnifyPower = bin.magnify;
    applyPayload(bin, model, 65536.0 / (model.magnifyPower * geometryDivisor(origin)));
    return buildMeshes(model);
  }
  if (bin.kind !== "animated") {
    model.format = `0x${(bin.signature >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
    return model;
  }
  // An animated BIN holds no geometry: it lists the other BINs that are its frames.
  model.format = "ANIMATED_BIN";
  model.frameNames = bin.frameNames.map(upper);
  applyPayload(EMPTY_PAYLOAD, model, 1.0 / BIN_GEOMETRY_DIVISOR.legacy);
  return buildMeshes(model);
}

function geometryDivisor(origin) {
  if (origin === "HB") return BIN_GEOMETRY_DIVISOR.hellbender;
  if (isTvFamilyOrigin(origin)) return BIN_GEOMETRY_DIVISOR.terminalVelocity;
  return BIN_GEOMETRY_DIVISOR.legacy;
}

function applyPayload(bin, model, scale) {
  if (!bin.vertexListValid) return;
  const words = bin.vertices;
  const rawVertices = [];
  let rawBaseZ = 0;
  let rawMinX = Infinity, rawMaxX = -Infinity;
  let rawMinY = Infinity, rawMaxY = -Infinity;
  let rawMinZ = Infinity, rawMaxZ = -Infinity;
  for (let i = 0; i < words.length; i += 3) {
    // The engine drops each word's low bit; the words are (x, z, y) with z up.
    const x = words[i] >> 1;
    const z = words[i + 1] >> 1;
    const y = words[i + 2] >> 1;
    rawVertices.push({ x, y, z });
    if (x < rawMinX) rawMinX = x; if (x > rawMaxX) rawMaxX = x;
    if (y < rawMinY) rawMinY = y; if (y > rawMaxY) rawMaxY = y;
    if (z < rawMinZ) rawMinZ = z; if (z > rawMaxZ) rawMaxZ = z;
    if (z < rawBaseZ) rawBaseZ = z;
  }
  // The engine's base height: the lowest z, never above 0, less 31.
  const rawBaseZWithOffset = rawBaseZ - 31;
  model.rawVertexBounds = { vertexCount: rawVertices.length, baseZ: rawBaseZWithOffset, minX: rawMinX, maxX: rawMaxX, minY: rawMinY, maxY: rawMaxY, minZ: rawMinZ, maxZ: rawMaxZ };
  model.vertices = rawVertices.map((v) => ({ x: v.x * scale, y: v.y * scale, z: v.z * scale }));
  model.baseZ = rawBaseZWithOffset * scale;
  const materials = bin.materials.map((material) => ({ ...material, tint: [...material.tint] }));
  // normalStrength is only meaningful when the record says it carries a normal map.
  const materials2 = bin.materials2.map(({ flags2, normalStrength, reserved }) => ({
    flags2, normalStrength: flags2 & MRGLMAT2.NORMALMAP ? normalStrength : 1, reserved: [...reserved],
  }));
  const polygons = [];
  const textureNames = new Set();
  for (const face of bin.faces) {
    const textureName = upper(face.textureName);
    const polygon = face.mapped
      ? {
        type: face.opcode, textureName, vertexIndices: [...face.vertexIndices], textureU: [...face.u], textureV: [...face.v],
        // Only MRGL_MATFACET consumes the current material; the legacy face types predate it.
        material: face.material === null ? null : materials[face.material],
        material2: face.material2 === null ? null : materials2[face.material2],
        solidColor: face.solidColor,
      }
      : { type: face.opcode, textureName, vertexIndices: [...face.vertexIndices], textureU: [...face.u], textureV: [...face.v], solidColor: face.solidColor };
    polygons.push(polygon);
    if (textureName) textureNames.add(textureName);
  }
  if (bin.magnifyRecords.length) model.magnifyPower = bin.magnifyRecords[bin.magnifyRecords.length - 1];
  model.warnings.push(...bin.warnings);
  for (const material2 of bin.materials2) {
    if (material2.reserved.some((value) => value !== 0)) model.warnings.push("MRGL_MATERIAL2 has non-zero reserved fields");
  }
  model.polygons = polygons;
  model.textureNames = [...textureNames];
  model.vertexCount = model.vertices.length;
  model.polygonCount = model.polygons.length;
}

function buildMeshes(model) {
  const verts = model.vertices ?? [];
  // Compute model-space anchor (matches JTraxx SoftwareModelRenderer.modelAnchor):
  // X,Y centered on bounding box midpoint; Z anchored to minimum (model bottom = 0)
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
  }
  const anchorX = verts.length ? (minX + maxX) / 2 : 0;
  const anchorY = verts.length ? (minY + maxY) / 2 : 0;
  const anchorZ = verts.length ? minZ : 0;

  model.anchor = { x: anchorX, y: anchorY, z: anchorZ };

  const grouped = new Map();
  for (const polygon of model.polygons ?? []) {
    const flags = polygon.material?.flags ?? 0;
    const transparent = polygon.material
      ? !!(flags & (MRGLMAT_BLEND | MRGLMAT_ALPHATEST | MRGLMAT_TEXSOLID))
      : TRANSPARENT_FACE_TYPES.has(polygon.type);
    const solid = polygon.type === 0x19;
    const materialKey = polygon.material ? `material:${polygon.material.id}:${polygon.material2?.normalStrength ?? 1}` : "legacy";
    const facetKey = solid ? `solid:${polygon.solidColor ?? 0}` : "textured";
    const key = `${polygon.textureName || "__flat__"}|${transparent ? "alpha" : "opaque"}|${facetKey}|${materialKey}`;
    if (!grouped.has(key)) grouped.set(key, { positions: [], normals: [], uvs: [], textureName: polygon.textureName || "", transparent, material: polygon.material, material2: polygon.material2, solid, solidColor: polygon.solidColor ?? 0 });
    triangulatePolygon(verts, polygon, grouped.get(key), anchorX, anchorY, anchorZ);
  }
  model.meshes = [...grouped.values()].map((b) => ({
    textureName: b.textureName,
    transparent: b.transparent === true,
    material: b.material ?? null,
    material2: b.material2 ?? null,
    solid: b.solid,
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    uvs: new Float32Array(b.uvs),
    color: b.solid ? (b.solidColor >>> 0) : representativeColor(b.textureName)
  }));
  return model;
}

// Stores vertices in JTraxx local space with 0.75 scale on Z (height).
function triangulatePolygon(vertices, polygon, bucket, anchorX, anchorY, anchorZ) {
  const { vertexIndices, textureU, textureV } = polygon;
  if (!vertexIndices || vertexIndices.length < 3) return;
  for (let i = 1; i < vertexIndices.length - 1; i++) {
    const tri = [0, i, i + 1];
    const jv = tri.map((k) => {
      const v = vertices[vertexIndices[k]];
      if (!v) return null;
      return [v.x - anchorX, v.y - anchorY, v.z - anchorZ];
    });
    if (!jv[0] || !jv[1] || !jv[2]) continue;
    const normal = computeNormal(jv[0], jv[1], jv[2]);
    for (let ki = 0; ki < 3; ki++) {
      const k = tri[ki];
      bucket.positions.push(jv[ki][0], jv[ki][1], jv[ki][2]);
      bucket.normals.push(normal[0], normal[1], normal[2]);
      // BIN stores V=0 at image-top; flip to Three.js bottom-origin convention.
      // flipY=true on the DataTexture in bin-preview.js completes the pair (mirrors JSTruckViewer).
      bucket.uvs.push((textureU[k] ?? 0) / UV_SCALE, 1 - (textureV[k] ?? 0) / UV_SCALE);
    }
  }
}

function computeNormal(a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function upper(v) { return (v ?? "").trim().toUpperCase(); }

function isTvFamilyOrigin(origin) { return origin === "TV" || origin === "F3" || origin === "TV/F3"; }

function representativeColor(textureName) {
  const seed = [...(textureName || "__flat__")].reduce((s, c) => s + c.charCodeAt(0), 0);
  return hslToRgb((seed % 360) / 360, 0.22, 0.64);
}

function hslToRgb(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return (Math.round(hue2rgb(h + 1/3) * 255) << 16) | (Math.round(hue2rgb(h) * 255) << 8) | Math.round(hue2rgb(h - 1/3) * 255);
}
