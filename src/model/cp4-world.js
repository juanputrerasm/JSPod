/*
  Community Patch 4 (MTM2 beta 0.52) binary world sidecars, read for preview only.

  .WTR (magic "MWTR") holds the lakes: a BODY chunk of water bodies and a TMAP chunk
  naming the body that covers each of the 256x256 terrain tiles.
  .VEG (magic "MVEG") holds the vegetation: species (SPEC), placed trees (TREE), grass
  clumps bucketed per tile (GRAS) and two CRLF key=value text chunks (RULE, INFO).
  4x4 Evolution's .VEG is plain text and carries no magic, so sniffing the first four
  bytes tells the two apart.

  Both files share one container: a 32-byte little-endian header (magic, u16 major,
  u16 minor, u32 header size, u32 chunk count, u16 tiles X, u16 tiles Z), then a
  directory of 16-byte entries {char id[4], u32 version, u32 offset, u32 size}.
  Records are read with the stride the chunk declares, so a later minor version that
  grows a record still previews.
*/

const latin1 = new TextDecoder("latin1");

/** "MWTR", "MVEG", or null when the bytes carry neither magic. */
export function cp4WorldMagic(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return magic === "MWTR" || magic === "MVEG" ? magic : null;
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function fourcc(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function cString(bytes, offset, length) {
  let end = offset;
  const limit = offset + length;
  while (end < limit && bytes[end] !== 0) end++;
  return latin1.decode(bytes.subarray(offset, end));
}

function readContainer(bytes, magic) {
  if (bytes.length < 32) throw new Error(`${magic} file is shorter than its 32-byte header`);
  if (fourcc(bytes, 0) !== magic) throw new Error(`Not an ${magic} file`);
  const dv = view(bytes);
  const header = {
    magic,
    major: dv.getUint16(4, true),
    minor: dv.getUint16(6, true),
    headerSize: dv.getUint32(8, true),
    chunkCount: dv.getUint32(12, true),
    tilesX: dv.getUint16(16, true),
    tilesZ: dv.getUint16(18, true),
  };
  if (magic === "MVEG") header.flags = dv.getUint32(20, true);
  const chunks = [];
  const dirStart = header.headerSize || 32;
  for (let i = 0; i < header.chunkCount; i++) {
    const at = dirStart + i * 16;
    if (at + 16 > bytes.length) throw new Error(`${magic} directory runs past the end of the file`);
    const chunk = {
      id: fourcc(bytes, at),
      version: dv.getUint32(at + 4, true),
      offset: dv.getUint32(at + 8, true),
      size: dv.getUint32(at + 12, true),
    };
    if (chunk.offset + chunk.size > bytes.length) throw new Error(`${magic} chunk ${chunk.id} runs past the end of the file`);
    chunk.bytes = bytes.subarray(chunk.offset, chunk.offset + chunk.size);
    chunks.push(chunk);
  }
  return { header, chunks, find: (id) => chunks.find((c) => c.id === id) ?? null };
}

/** Reads the {u32 count, u16 stride, u16 0} table head and yields each record's offset. */
function recordTable(chunk, minStride, extraHead = 0) {
  if (!chunk || chunk.bytes.length < 8) return { count: 0, stride: minStride, start: 8, dv: null };
  const dv = view(chunk.bytes);
  const count = dv.getUint32(0, true);
  const stride = dv.getUint16(4, true) || minStride;
  if (stride < minStride) throw new Error(`${chunk.id} record stride ${stride} is below ${minStride}`);
  const start = 8 + extraHead;
  const fits = Math.max(0, Math.floor((chunk.bytes.length - start) / stride));
  return { count: Math.min(count, fits), declared: count, stride, start, dv };
}

/** Parses an MWTR lakes file. */
export function parseMwtr(bytes) {
  const { header, chunks, find } = readContainer(bytes, "MWTR");
  const bodies = [];
  const body = find("BODY");
  const table = recordTable(body, 48);
  for (let i = 0; i < table.count; i++) {
    const o = table.start + i * table.stride;
    const dv = table.dv;
    const nseeds = body.bytes[o + 1];
    const seeds = [];
    for (let s = 0; s < Math.min(nseeds, 8); s++) {
      seeds.push({ x: dv.getUint16(o + 8 + s * 4, true), z: dv.getUint16(o + 10 + s * 4, true) });
    }
    const height = dv.getUint32(o + 4, true);
    bodies.push({
      id: body.bytes[o],
      seeds,
      flags: dv.getUint16(o + 2, true),
      reflective: (dv.getUint16(o + 2, true) & 1) !== 0,
      height,
      heightFeet: height / 2,
      bounds: { minX: body.bytes[o + 40], minZ: body.bytes[o + 41], maxX: body.bytes[o + 42], maxZ: body.bytes[o + 43] },
      tileCount: dv.getUint32(o + 44, true),
    });
  }
  const tmapChunk = find("TMAP");
  const tiles = header.tilesX * header.tilesZ;
  const tmap = tmapChunk && tmapChunk.bytes.length >= tiles ? tmapChunk.bytes.subarray(0, tiles) : null;
  return { header, chunks: chunks.map(stripBytes), bodies, declaredBodies: table.declared ?? 0, tmap };
}

/** Parses an MVEG vegetation file. */
export function parseMveg(bytes) {
  const { header, chunks, find } = readContainer(bytes, "MVEG");

  const species = [];
  const spec = find("SPEC");
  const specTable = recordTable(spec, 136);
  for (let i = 0; i < specTable.count; i++) {
    const o = specTable.start + i * specTable.stride;
    const flags = spec.bytes[o + 130];
    species.push({
      model: cString(spec.bytes, o, 64),
      farModel: cString(spec.bytes, o + 64, 64),
      kind: spec.bytes[o + 128],
      collide: spec.bytes[o + 129],
      flags,
      trunkDiameterFeet: specTable.dv.getUint16(o + 132, true) / 64,
      trunkHeightFeet: specTable.dv.getUint16(o + 134, true) / 16,
      count: 0,
    });
  }

  const trees = [];
  const tree = find("TREE");
  const treeTable = recordTable(tree, 20);
  for (let i = 0; i < treeTable.count; i++) {
    const o = treeTable.start + i * treeTable.stride;
    const dv = treeTable.dv;
    const record = {
      x: dv.getInt32(o, true) / 256,
      y: dv.getInt32(o + 4, true) / 256,
      z: dv.getInt32(o + 8, true) / 256,
      species: dv.getUint16(o + 12, true),
      heading: dv.getUint16(o + 14, true) / 65536,
      scale: dv.getUint16(o + 16, true) / 4096,
      tint: tree.bytes[o + 18],
      tier: tree.bytes[o + 19],
    };
    trees.push(record);
    if (species[record.species]) species[record.species].count++;
  }

  const grassTiles = [];
  let clumps = 0;
  const gras = find("GRAS");
  if (gras && gras.bytes.length >= 12) {
    const dv = view(gras.bytes);
    clumps = dv.getUint32(0, true);
    const tileCount = Math.min(dv.getUint32(8, true), Math.floor((gras.bytes.length - 12) / 12));
    for (let i = 0; i < tileCount; i++) {
      const o = 12 + i * 12;
      grassTiles.push({ tx: dv.getUint16(o, true), tz: dv.getUint16(o + 2, true), first: dv.getUint32(o + 4, true), count: dv.getUint32(o + 8, true) });
    }
  }

  const text = (id) => {
    const chunk = find(id);
    return chunk ? latin1.decode(chunk.bytes) : null;
  };

  return {
    header,
    chunks: chunks.map(stripBytes),
    species,
    trees,
    declaredTrees: treeTable.declared ?? 0,
    grassTiles,
    clumps,
    rule: text("RULE"),
    info: text("INFO"),
  };
}

function stripBytes({ id, version, offset, size }) {
  return { id, version, offset, size };
}

/*
  CP4 terrain heights. DATA\<track>.RAW is the 256x256 8-bit map the stock game reads;
  CP4 also accepts a u16 little-endian 256x256 (131,072 bytes) or a 1024x1024 at an
  8 ft grid (2,097,152 bytes), both in 1/128 ft. CART Precision Racing ships 131,072-byte
  u16 RAWs too, in 1/16 ft, so that size keeps both readings on offer.
*/
export const HEIGHTMAP_SCALES = {
  cp4: { label: "CP4 (feet = v / 128)", divisor: 128 },
  cpr: { label: "CPR (feet = v / 16)",  divisor: 16 },
};

/** { side, interpretations } for a 16-bit heightmap RAW in a DATA folder, else null. */
export function heightmapRawLayout(path, byteLength) {
  const inData = /(^|[\\/])DATA[\\/][^\\/]+\.RAW$/i.test(String(path ?? ""));
  if (!inData) return null;
  if (byteLength === 131072) return { side: 256, gridFeet: 32, interpretations: ["cp4", "cpr"] };
  if (byteLength === 2097152) return { side: 1024, gridFeet: 8, interpretations: ["cp4"] };
  return null;
}

/** u16 LE samples to { values, min, max } in raw units. */
export function readHeightSamples(bytes, side) {
  const dv = view(bytes);
  const count = side * side;
  const values = new Uint16Array(count);
  let min = 65535;
  let max = 0;
  for (let i = 0; i < count; i++) {
    const v = dv.getUint16(i * 2, true);
    values[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { values, min, max };
}
