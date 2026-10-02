/*
  Nocturne KFM models adapted to JSPod's shared model-preview shape. Parsing stays in
  OpenPhotex; this file only triangulates, converts fixed point and changes Y-up Nocturne
  coordinates to the Z-up intermediate convention used by bin-preview.js.
*/
import { parseDfm, parseKfm, parseSkl } from "../vendor/openphotex/index.js";

const TEXT_UV_SCALE = 0x1000000;
const BINARY_UV_SCALE = 0x10000;
const POSITION_SCALE = 1 / 256;

export function inspectDfm(bytes, modelName) {
  const dfm = parseDfm(bytes, modelName);
  return { skeleton: dfm.skeleton };
}

export function decodeDfmModel(dfmBytes, sklBytes, modelName, options = {}) {
  const dfm = parseDfm(dfmBytes, modelName);
  if (!sklBytes) return emptyDfm(dfm, modelName, `Skeleton ${dfm.skeleton} is not in this archive.`);
  const skl = parseSkl(sklBytes, dfm.skeleton);
  if (skl.boneCount !== dfm.boneCount) return emptyDfm(dfm, modelName, `DFM has ${dfm.boneCount} bones but ${dfm.skeleton} has ${skl.boneCount}.`);
  const lodIndex = clampIndex(options.lodIndex, dfm.lods.length);
  const frameIndex = clampIndex(options.frameIndex, skl.frameCount);
  return decodeDfmPose(dfm, skl, modelName, lodIndex, frameIndex);
}

export function decodeDfmMotionModel(dfmBytes, sklBytes, modelName, options = {}) {
  const dfm = parseDfm(dfmBytes, modelName);
  if (!sklBytes) return emptyDfm(dfm, modelName, `Skeleton ${dfm.skeleton} is not in this archive.`);
  const skl = parseSkl(sklBytes, dfm.skeleton);
  if (skl.boneCount !== dfm.boneCount) return emptyDfm(dfm, modelName, `DFM has ${dfm.boneCount} bones but ${dfm.skeleton} has ${skl.boneCount}.`);
  const lodIndex = clampIndex(options.lodIndex, dfm.lods.length);
  const motionIndex = clampIndex(options.motionIndex, skl.motions.length);
  const motion = skl.motions[motionIndex];
  if (!motion || motion.frameCount < 2) {
    return decodeDfmPose(dfm, skl, modelName, lodIndex, motion?.frameStart ?? options.frameIndex ?? 0);
  }

  const frameStart = clampIndex(motion.frameStart, skl.frameCount);
  const frameCount = Math.min(motion.frameCount, skl.frameCount - frameStart);
  if (frameCount < 2) return decodeDfmPose(dfm, skl, modelName, lodIndex, frameStart);
  const base = decodeDfmPose(dfm, skl, modelName, lodIndex, frameStart);
  const keyframes = [];
  for (let relative = 0; relative < frameCount; relative++) {
    const pose = relative === 0
      ? base
      : decodeDfmPose(dfm, skl, modelName, lodIndex, frameStart + relative);
    keyframes.push(alignPoseToBase(base, pose));
  }
  base.keyframes = keyframes;
  base.keyframeAnimation = {
    kind: "dfm",
    fps: Number.isFinite(motion.fps) && motion.fps > 0 ? motion.fps : 30,
    frameStart,
    frameCount,
    initialIndex: Math.max(0, Math.min(frameCount - 1, (options.frameIndex ?? frameStart) - frameStart)),
  };
  base.warnings = [
    `Showing LOD ${lodIndex + 1} of ${dfm.lods.length}.`,
    `Looping ${motion.name} at ${base.keyframeAnimation.fps} fps.`,
  ];
  return base;
}

function decodeDfmPose(dfm, skl, modelName, lodIndex, frameIndex) {
  const rotationBase = frameIndex * dfm.boneCount * 4;
  const globalPositions = new Array(dfm.boneCount), globalRotations = new Array(dfm.boneCount);
  for (let bone = 0; bone < dfm.boneCount; bone++) {
    const at = rotationBase + bone * 4;
    const localRotation = [...skl.rotations.subarray(at, at + 4)];
    const parent = skl.bones[bone].parent;
    if (parent < 0) {
      const rootAt = frameIndex * 3;
      globalPositions[bone] = dfm.boneOrigins[bone].map((value, axis) =>
        value + skl.rootOffsets[rootAt + axis] * dfm.rootOffsetScale[axis]);
      globalRotations[bone] = localRotation;
    } else {
      globalRotations[bone] = multiplyQuaternion(globalRotations[parent], localRotation);
      const offset = rotateVector(globalRotations[parent], dfm.boneOrigins[bone]);
      globalPositions[bone] = offset.map((value, axis) => value + globalPositions[parent][axis]);
    }
  }
  const lod = dfm.lods[lodIndex];
  const vertices = lod.vertices.map((influences) => {
    const vertex = [0, 0, 0];
    for (const influence of influences) {
      const rotated = rotateVector(globalRotations[influence.bone], influence.position);
      for (let axis = 0; axis < 3; axis++) vertex[axis] += (rotated[axis] + globalPositions[influence.bone][axis]) * influence.weight;
    }
    // Nocturne is Y-up; the shared preview adapter is Z-up before bin-preview swaps it.
    return [vertex[0], vertex[2], vertex[1]];
  });
  const anchor = vertexAnchor(vertices);
  const grouped = new Map();
  for (const triangle of lod.triangles) {
    const textureName = String(dfm.textures[triangle.texture] ?? "").trim().toUpperCase();
    if (!grouped.has(textureName)) grouped.set(textureName, { positions: [], normals: [], uvs: [] });
    const bucket = grouped.get(textureName);
    const points = triangle.vertices.map((index) => vertices[index]);
    if (points.some((point) => !point)) continue;
    const normal = faceNormal(points[0], points[1], points[2]);
    for (let corner = 0; corner < 3; corner++) {
      bucket.positions.push(points[corner][0] - anchor[0], points[corner][1] - anchor[1], points[corner][2] - anchor[2]);
      bucket.normals.push(...normal);
      bucket.uvs.push(triangle.uv[corner][0] / TEXT_UV_SCALE, 1 - triangle.uv[corner][1] / TEXT_UV_SCALE);
    }
  }
  const meshes = [...grouped].map(([textureName, bucket]) => ({
    textureName, transparent: true, doubleSided: false, material: null, material2: null,
    solid: false, color: 0xbfbfbf,
    positions: new Float32Array(bucket.positions), normals: new Float32Array(bucket.normals), uvs: new Float32Array(bucket.uvs),
  }));
  return {
    name: modelName,
    format: `DFM v${dfm.version} / SKL v${skl.version}`,
    magnifyPower: null,
    baseZ: anchor[2],
    anchor: { x: anchor[0], y: anchor[1], z: anchor[2] },
    vertexCount: lod.vertexCount,
    polygonCount: lod.triangles.length,
    textureNames: [...new Set(dfm.textures.slice(0, dfm.textureCount).map((name) => name.trim().toUpperCase()).filter(Boolean))],
    meshes,
    warnings: [
      `Showing LOD ${lodIndex + 1} of ${dfm.lods.length}.`,
      `Showing skeleton frame ${frameIndex + 1} of ${skl.frameCount}.`,
    ],
    nocturne: {
      kind: "dfm",
      lodIndex,
      frameIndex,
      lods: dfm.lods.map((item, index) => ({ index, vertexCount: item.vertexCount, triangleCount: item.triangles.length, pixelHeight: item.pixelHeight, shadowOnly: item.shadowOnly })),
      motions: skl.motions.map((motion, index) => ({ index, name: motion.name, fps: motion.fps, frameStart: motion.frameStart, frameCount: motion.frameCount })),
    },
  };
}

function alignPoseToBase(base, pose) {
  const dx = pose.anchor.x - base.anchor.x;
  const dy = pose.anchor.y - base.anchor.y;
  const dz = pose.anchor.z - base.anchor.z;
  return {
    meshes: pose.meshes.map((mesh) => {
      const positions = new Float32Array(mesh.positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] = mesh.positions[i] + dx;
        positions[i + 1] = mesh.positions[i + 1] + dy;
        positions[i + 2] = mesh.positions[i + 2] + dz;
      }
      return { positions, normals: new Float32Array(mesh.normals) };
    }),
  };
}

function emptyDfm(dfm, modelName, warning) {
  return { name: modelName, format: `DFM v${dfm.version}`, magnifyPower: null, baseZ: null, anchor: { x: 0, y: 0, z: 0 }, vertexCount: dfm.lods[0]?.vertexCount ?? 0, polygonCount: dfm.lods[0]?.triangles.length ?? 0, textureNames: dfm.textures, meshes: [], warnings: [warning] };
}

function vertexAnchor(vertices) {
  if (!vertices.length) return [0, 0, 0];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  for (const [x, y, z] of vertices) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); }
  return [(minX + maxX) / 2, (minY + maxY) / 2, minZ];
}

function multiplyQuaternion(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function rotateVector(q, vector) {
  const result = multiplyQuaternion(multiplyQuaternion(q, [0, ...vector]), [q[0], -q[1], -q[2], -q[3]]);
  return result.slice(1);
}

export function decodeKfmModel(bytes, modelName, options = {}) {
  const kfm = parseKfm(bytes, modelName);
  const frameIndex = clampIndex(options.frameIndex, kfm.frameCount);
  const frameOffset = frameIndex * kfm.vertexCount * 3;
  const vertices = new Array(kfm.vertexCount);
  let minX = Infinity, maxX = -Infinity, minDepth = Infinity, maxDepth = -Infinity, minHeight = Infinity;
  for (let i = 0; i < kfm.vertexCount; i++) {
    const at = frameOffset + i * 3;
    const x = kfm.vertices[at] * POSITION_SCALE;
    const height = kfm.vertices[at + 1] * POSITION_SCALE;
    const depth = kfm.vertices[at + 2] * POSITION_SCALE;
    vertices[i] = [x, depth, height];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minDepth = Math.min(minDepth, depth); maxDepth = Math.max(maxDepth, depth);
    minHeight = Math.min(minHeight, height);
  }
  const anchor = kfm.vertexCount
    ? [(minX + maxX) / 2, (minDepth + maxDepth) / 2, minHeight]
    : [0, 0, 0];
  const grouped = new Map();
  const uvScale = kfm.binary ? BINARY_UV_SCALE : TEXT_UV_SCALE;
  for (const polygon of kfm.polygons) {
    const textureName = String(kfm.textures[polygon.texture] ?? "").trim().toUpperCase();
    if (!grouped.has(textureName)) grouped.set(textureName, { positions: [], normals: [], uvs: [] });
    const bucket = grouped.get(textureName);
    for (let corner = 1; corner < polygon.corners.length - 1; corner++) {
      const triangle = [polygon.corners[0], polygon.corners[corner], polygon.corners[corner + 1]];
      const points = triangle.map(({ vertex }) => vertices[vertex]);
      if (points.some((point) => !point)) continue;
      const normal = faceNormal(points[0], points[1], points[2]);
      for (let i = 0; i < 3; i++) {
        bucket.positions.push(points[i][0] - anchor[0], points[i][1] - anchor[1], points[i][2] - anchor[2]);
        bucket.normals.push(...normal);
        bucket.uvs.push(triangle[i].u / uvScale, 1 - triangle[i].v / uvScale);
      }
    }
  }
  const meshes = [...grouped].map(([textureName, bucket]) => ({
    textureName,
    transparent: kfm.transparentPixel,
    doubleSided: kfm.disableBackfaceCulling,
    material: null,
    material2: null,
    solid: false,
    color: 0xbfbfbf,
    positions: new Float32Array(bucket.positions),
    normals: new Float32Array(bucket.normals),
    uvs: new Float32Array(bucket.uvs),
  }));
  return {
    name: modelName,
    format: `KFM v${kfm.version}${kfm.binary ? " binary" : ""}`,
    magnifyPower: null,
    baseZ: minHeight === Infinity ? null : minHeight,
    anchor: { x: anchor[0], y: anchor[1], z: anchor[2] },
    vertexCount: kfm.vertexCount,
    polygonCount: kfm.polygonCount,
    textureNames: [...new Set(kfm.textures.map((name) => name.trim().toUpperCase()).filter(Boolean))],
    meshes,
    warnings: kfm.frameCount > 1 ? [`Showing morph frame ${frameIndex + 1} of ${kfm.frameCount}.`] : [],
    nocturne: { kind: "kfm", frameIndex, frameCount: kfm.frameCount },
  };
}

function clampIndex(value, count) {
  const integer = Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(0, Math.min(Math.max(0, count - 1), integer));
}

function faceNormal(a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const x = aby * acz - abz * acy, y = abz * acx - abx * acz, z = abx * acy - aby * acx;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
