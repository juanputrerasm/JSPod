/*
  .SMF v2-v4, the static model format of 4x4 Evolution 1 and 2 ("C3DModel").

    "C3DModel"
    fileVersion
    objectCount
    if fileVersion >= 4: lodEnabled,lodSwitchHeight

    repeat objectCount:
        objectName
        if fileVersion >= 2: visible
        objectVersion
        vertexCount,frameCount,faceCount,unknown0
        ["v1"]                                        optional Evo 2 material marker
        material0,material1,material2,transparent,reflective,textureName
        if v1: bumpTextureName
        repeat frameCount:
            repeat vertexCount: x,y,z,nx,ny,nz,u,v
        repeat faceCount: i0,i1,i2

  Read as a counted state machine rather than by sniffing where the vertex block ends: a
  vertex line and a face line are both just comma-separated numbers, and the counts are the
  only thing that distinguishes them. Every count and every face index is validated.

  Verified against all 118 models in the ASPEN, THEHILL, BAJBEACH and PEAK stock tracks -
  115 v4, 2 v2, 1 v3 - every file consumed exactly to its trailing blank line. That corpus
  covers the Evo 2 "v1" bump-material form, a genuine 30-frame animated group, and the v2/v3
  files that carry no LOD header.

  Output deliberately matches what bin-decoder.js produces, so one model viewer draws both.
  Two things differ and travel with the model rather than being assumed by the viewer:

    - `upAxis` is "Y". .BIN is Z-up and the preview swaps its axes; .SMF is authored Y-up
      and must not be swapped. A pine tree is tall in Y, a fallen log is long in Z, and the
      Evo 2 .SIT `size` field equals the model's XYZ extent for all 57 distinct stock models,
      which is what settles the axis order rather than inference from a few bounding boxes.

    - `uvOrigin` is "top-left". Evo's V runs top-down; the preview uploads .SMF art without
      the Y flip it gives .BIN art. Flipping here, as the Blender add-on does because
      Blender's V is bottom-up, renders every texture upside down.

  Faces are expanded to a triangle soup because that is the shape the .BIN path already
  emits; the models are small enough that the duplication costs nothing.
*/

const SMF_MAGIC = "C3DModel";
const MAX_OBJECTS = 4096;
const MAX_VERTICES = 1 << 20;
const MAX_FACES = 1 << 20;

/*
  A reduced-detail group is its high-detail partner's name suffixed with "L":
  OPAQUE/OPAQUEL, TRANSP/TRANSPL. Observed stock spellings are case variants of OPAQUE,
  OPAQUEL, TRANSP, TRANSPI, TRANSPE and TRANSPL, so TRANSPI and TRANSPE are full-detail
  groups and only the trailing L is significant.
*/
const LOD_GROUP_PATTERN = /^(opaque|transp)l$/i;

/** True when these bytes begin a C3DModel, whatever the entry is called. */
export function isSmfModel(bytes) {
  if (!bytes || bytes.length < SMF_MAGIC.length) return false;
  for (let i = 0; i < SMF_MAGIC.length; i++) {
    if (bytes[i] !== SMF_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

export function decodeSmfModel(bytes, modelName) {
  const lines = new TextDecoder("latin1")
    .decode(bytes)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  let cursor = 0;
  const warnings = [];
  const next = () => (cursor < lines.length ? lines[cursor++].trim() : null);
  const peek = () => (cursor < lines.length ? lines[cursor].trim() : null);

  if (next() !== SMF_MAGIC) throw new Error(`${modelName}: not a C3DModel`);
  const fileVersion = int(next());
  if (!(fileVersion >= 1 && fileVersion <= 4)) {
    throw new Error(`${modelName}: unsupported .SMF version ${fileVersion}`);
  }
  const objectCount = int(next());
  if (!(objectCount >= 0 && objectCount <= MAX_OBJECTS)) {
    throw new Error(`${modelName}: implausible object count ${objectCount}`);
  }

  let lodEnabled = false;
  let lodSwitchHeight = 0;
  if (fileVersion >= 4) {
    const parts = (next() ?? "").split(",");
    lodEnabled = (parts[0] ?? "").trim() !== "0";
    lodSwitchHeight = float(parts[1]);
  }

  const meshes = [];
  const textureNames = [];
  const seenTextures = new Set();
  let totalVertices = 0;
  let totalPolygons = 0;

  for (let o = 0; o < objectCount; o++) {
    const groupName = next();
    if (groupName === null) {
      warnings.push(`ran out of lines at object ${o + 1} of ${objectCount}`);
      break;
    }
    const visible = fileVersion >= 2 ? next() !== "0" : true;
    const objectVersion = int(next());

    const counts = (next() ?? "").split(",");
    const vertexCount = int(counts[0]);
    const frameCount = Math.max(1, int(counts[1]));
    const faceCount = int(counts[2]);
    const objectInfo = (counts[3] ?? "").trim();
    if (!(vertexCount >= 0 && vertexCount <= MAX_VERTICES) || !(faceCount >= 0 && faceCount <= MAX_FACES)) {
      throw new Error(`${modelName}: implausible counts in group "${groupName}" (${vertexCount} verts, ${faceCount} faces)`);
    }

    // The Evo 2 bump form announces itself with a bare "v1" line before the material.
    const bumpForm = peek() === "v1";
    if (bumpForm) next();

    const material = (next() ?? "").split(",");
    const textureName = (material[5] ?? "").trim();
    const bumpTextureName = bumpForm ? (next() ?? "").replace(/"/g, "").trim() : null;

    /*
      Frame 0 is what gets drawn. Later frames are still read line by line so the cursor
      stays aligned with the face block that follows; their position is counted, so skipping
      them cannot desynchronise the walk.
    */
    const vx = new Float32Array(vertexCount * 3);
    const vn = new Float32Array(vertexCount * 3);
    const vt = new Float32Array(vertexCount * 2);
    for (let f = 0; f < frameCount; f++) {
      for (let v = 0; v < vertexCount; v++) {
        const line = next();
        if (line === null) throw new Error(`${modelName}: truncated vertex block in "${groupName}"`);
        if (f !== 0) continue;
        const p = line.split(",");
        vx[v * 3] = float(p[0]); vx[v * 3 + 1] = float(p[1]); vx[v * 3 + 2] = float(p[2]);
        vn[v * 3] = float(p[3]); vn[v * 3 + 1] = float(p[4]); vn[v * 3 + 2] = float(p[5]);
        vt[v * 2] = float(p[6]); vt[v * 2 + 1] = float(p[7]);
      }
    }

    const positions = new Float32Array(faceCount * 9);
    const normals = new Float32Array(faceCount * 9);
    const uvs = new Float32Array(faceCount * 6);
    let triangles = 0;
    for (let f = 0; f < faceCount; f++) {
      const line = next();
      if (line === null) throw new Error(`${modelName}: truncated face block in "${groupName}"`);
      const parts = line.split(",");
      const tri = [int(parts[0]), int(parts[1]), int(parts[2])];
      if (tri.some((index) => index < 0 || index >= vertexCount)) {
        warnings.push(`"${groupName}" face ${f} indexes outside its ${vertexCount} vertices`);
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const src = tri[c];
        const dst = triangles * 9 + c * 3;
        positions[dst] = vx[src * 3]; positions[dst + 1] = vx[src * 3 + 1]; positions[dst + 2] = vx[src * 3 + 2];
        normals[dst] = vn[src * 3]; normals[dst + 1] = vn[src * 3 + 1]; normals[dst + 2] = vn[src * 3 + 2];
        uvs[triangles * 6 + c * 2] = vt[src * 2];
        uvs[triangles * 6 + c * 2 + 1] = vt[src * 2 + 1];
      }
      triangles++;
    }

    if (textureName && !seenTextures.has(textureName.toUpperCase())) {
      seenTextures.add(textureName.toUpperCase());
      textureNames.push(textureName.toUpperCase());
    }
    totalVertices += vertexCount;
    totalPolygons += triangles;

    meshes.push({
      groupName,
      visible,
      objectVersion,
      lod: LOD_GROUP_PATTERN.test(groupName),
      textureName: textureName ? textureName.toUpperCase() : null,
      bumpTextureName: bumpTextureName ? bumpTextureName.toUpperCase() || null : null,
      // Material fields 3 and 4 are the transparency and reflectivity flags. Fields 0-2 are
      // three scalars of unknown meaning; every stock model writes 1.0, 1.0, 32.0.
      transparent: (material[3] ?? "0").trim() !== "0",
      reflective: (material[4] ?? "0").trim() !== "0",
      materialScalars: [float(material[0]), float(material[1]), float(material[2])],
      objectInfo,
      frameCount,
      // A .SMF sheet is meant to be seen from both faces; its foliage, fences and banners
      // are single-sided quads. The .BIN path's BackSide default would hide half of them.
      doubleSided: true,
      color: 0xbfbfbf,
      material: null,
      material2: null,
      solid: false,
      positions: triangles === faceCount ? positions : positions.slice(0, triangles * 9),
      normals: triangles === faceCount ? normals : normals.slice(0, triangles * 9),
      uvs: triangles === faceCount ? uvs : uvs.slice(0, triangles * 6),
    });
  }

  const drawable = meshes.filter((mesh) => mesh.visible && !mesh.lod && mesh.positions.length > 0);
  // Dropping the reduced-detail groups must never empty a model: one that carries only a
  // low-detail or hidden group is still better drawn than reported as having no geometry.
  const withGeometry = meshes.filter((mesh) => mesh.positions.length > 0);

  return {
    name: modelName,
    format: fileVersion >= 4 && lodEnabled ? `SMF v${fileVersion} (LOD)` : `SMF v${fileVersion}`,
    fileVersion,
    lodEnabled,
    lodSwitchHeight,
    // Evo geometry is Y-up and its V runs top-down; see the header comment.
    upAxis: "Y",
    uvOrigin: "top-left",
    magnifyPower: null,
    baseZ: null,
    anchor: { x: 0, y: 0, z: 0 },
    vertexCount: totalVertices,
    polygonCount: totalPolygons,
    textureNames,
    meshes: drawable.length ? drawable : withGeometry,
    hiddenMeshCount: meshes.length - (drawable.length ? drawable.length : withGeometry.length),
    warnings,
  };
}

function int(value) {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function float(value) {
  const parsed = Number.parseFloat((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
