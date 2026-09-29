/*
  .SMF models for JSPod's model viewer, in the same convention bin-decoder.js uses so one
  viewer draws both formats with one code path.

  Parsing is OpenPhotex's (parseSmf returns the model in Evo's own axes, as written). This
  adapter reshapes frame 0: Evo is Y-up and .BIN is Z-up, so Y and Z are swapped, normals are
  negated to suit the viewer's BackSide drawing, V is inverted to cancel the upload's flipY,
  and faces are expanded to the triangle soup the .BIN path emits. See JSTruckViewer's
  src/worker/evo/smf-parser.js for the reasoning behind each.
*/
import { isSmfModel, parseSmf } from "../vendor/openphotex/index.js";

export { isSmfModel };

export function decodeSmfModel(bytes, modelName) {
  const smf = parseSmf(bytes, modelName);
  const meshes = [];
  const textureNames = [];
  const seenTextures = new Set();
  let totalVertices = 0;
  let totalPolygons = 0;
  for (const group of smf.groups) {
    const { positions: p, normals: n, uvs: t } = group.frames[0];
    const faces = group.indices;
    const positions = new Float32Array(faces.length * 3);
    const normals = new Float32Array(faces.length * 3);
    const uvs = new Float32Array(faces.length * 2);
    for (let c = 0; c < faces.length; c++) {
      const v = faces[c];
      positions[c * 3] = p[v * 3]; positions[c * 3 + 1] = p[v * 3 + 2]; positions[c * 3 + 2] = p[v * 3 + 1];
      normals[c * 3] = -n[v * 3]; normals[c * 3 + 1] = -n[v * 3 + 2]; normals[c * 3 + 2] = -n[v * 3 + 1];
      uvs[c * 2] = t[v * 2]; uvs[c * 2 + 1] = 1 - t[v * 2 + 1];
    }
    const textureName = group.material.textureName;
    if (textureName && !seenTextures.has(textureName.toUpperCase())) {
      seenTextures.add(textureName.toUpperCase());
      textureNames.push(textureName.toUpperCase());
    }
    const bump = group.material.bumpTextureName === null ? null : group.material.bumpTextureName.replace(/"/g, "").trim();
    totalVertices += group.vertexCount;
    totalPolygons += faces.length / 3;
    meshes.push({
      groupName: group.name,
      visible: group.visible,
      objectVersion: group.objectVersion,
      lod: group.lodGroup,
      textureName: textureName ? textureName.toUpperCase() : null,
      bumpTextureName: bump ? bump.toUpperCase() || null : null,
      // Material fields 3 and 4 are the transparency and reflectivity flags; fields 0-2 are
      // three scalars whose meaning is not established.
      transparent: group.material.transparent,
      reflective: group.material.reflective,
      materialScalars: [...group.material.scalars],
      objectInfo: group.objectInfo,
      frameCount: group.frameCount,
      // A .SMF sheet is meant to be seen from both faces; its foliage, fences and banners are
      // single-sided quads. The .BIN path's BackSide default would hide half of them.
      doubleSided: true,
      color: 0xbfbfbf,
      material: null,
      material2: null,
      solid: false,
      positions,
      normals,
      uvs,
    });
  }

  const drawable = meshes.filter((mesh) => mesh.visible && !mesh.lod && mesh.positions.length > 0);
  // Dropping the reduced-detail groups must never empty a model: one that carries only a
  // low-detail or hidden group is still better drawn than reported as having no geometry.
  const withGeometry = meshes.filter((mesh) => mesh.positions.length > 0);
  const { fileVersion, lodEnabled, lodSwitchHeight } = smf;
  return {
    name: modelName,
    format: fileVersion >= 4 && lodEnabled ? `SMF v${fileVersion} (LOD)` : `SMF v${fileVersion}`,
    fileVersion,
    lodEnabled,
    lodSwitchHeight,
    magnifyPower: null,
    baseZ: null,
    anchor: { x: 0, y: 0, z: 0 },
    vertexCount: totalVertices,
    polygonCount: totalPolygons,
    textureNames,
    meshes: drawable.length ? drawable : withGeometry,
    hiddenMeshCount: meshes.length - (drawable.length ? drawable.length : withGeometry.length),
    warnings: smf.warnings,
  };
}
