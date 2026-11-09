import test from "node:test";
import assert from "node:assert/strict";
import { cp4WorldMagic, parseMwtr, parseMveg, heightmapRawLayout, readHeightSamples } from "../src/model/cp4-world.js";
import { getFileTypeInfo, getRawDescription, getHdMapRole } from "../src/file-type-info.js";

function container(magic, chunks, flags = 0) {
  const dirSize = chunks.length * 16;
  let offset = 32 + dirSize;
  const total = offset + chunks.reduce((n, c) => n + c.bytes.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([...magic].map((c) => c.charCodeAt(0)), 0);
  dv.setUint16(4, 1, true);
  dv.setUint32(8, 32, true);
  dv.setUint32(12, chunks.length, true);
  dv.setUint16(16, 256, true);
  dv.setUint16(18, 256, true);
  dv.setUint32(20, flags, true);
  chunks.forEach((c, i) => {
    const at = 32 + i * 16;
    out.set([...c.id].map((ch) => ch.charCodeAt(0)), at);
    dv.setUint32(at + 4, 1, true);
    dv.setUint32(at + 8, offset, true);
    dv.setUint32(at + 12, c.bytes.length, true);
    out.set(c.bytes, offset);
    offset += c.bytes.length;
  });
  return out;
}

function table(count, stride, fill, extra = 0) {
  const bytes = new Uint8Array(8 + extra + count * stride);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, count, true);
  dv.setUint16(4, stride, true);
  for (let i = 0; i < count; i++) fill(dv, bytes, 8 + extra + i * stride, i);
  return bytes;
}

test("cp4: magic sniffing tells MWTR and MVEG from Evo text", () => {
  assert.equal(cp4WorldMagic(new TextEncoder().encode("MWTR....")), "MWTR");
  assert.equal(cp4WorldMagic(new TextEncoder().encode("MVEG")), "MVEG");
  assert.equal(cp4WorldMagic(new TextEncoder().encode("tree oak 1 2 3")), null);
  assert.equal(cp4WorldMagic(new Uint8Array(2)), null);
});

test("cp4: MWTR bodies and tile map", () => {
  const body = table(2, 64, (dv, b, o, i) => {
    b[o] = i + 1;
    b[o + 1] = 2;
    dv.setUint16(o + 2, i === 0 ? 1 : 0, true);
    dv.setUint32(o + 4, 301, true);
    dv.setUint16(o + 8, 10, true); dv.setUint16(o + 10, 20, true);
    b[o + 40] = 5; b[o + 41] = 6; b[o + 42] = 7; b[o + 43] = 8;
    dv.setUint32(o + 44, 42 + i, true);
  });
  const tmap = new Uint8Array(65536);
  tmap[3 + 4 * 256] = 2;
  const lakes = parseMwtr(container("MWTR", [{ id: "BODY", bytes: body }, { id: "TMAP", bytes: tmap }]));
  assert.equal(lakes.bodies.length, 2);
  assert.equal(lakes.bodies[0].reflective, true);
  assert.equal(lakes.bodies[1].reflective, false);
  assert.equal(lakes.bodies[0].heightFeet, 150.5);
  assert.deepEqual(lakes.bodies[0].seeds, [{ x: 10, z: 20 }, { x: 0, z: 0 }]);
  assert.deepEqual(lakes.bodies[1].bounds, { minX: 5, minZ: 6, maxX: 7, maxZ: 8 });
  assert.equal(lakes.bodies[1].tileCount, 43);
  assert.equal(lakes.tmap[3 + 4 * 256], 2);
  assert.deepEqual(lakes.chunks.map((c) => c.id), ["BODY", "TMAP"]);
});

test("cp4: MVEG species, trees, grass and text chunks", () => {
  const spec = table(1, 192, (dv, b, o) => {
    b.set(new TextEncoder().encode("OAK.BIN"), o);
    b.set(new TextEncoder().encode("OAKFAR.BIN"), o + 64);
    b[o + 128] = 0; b[o + 129] = 1; b[o + 130] = 1 | 8;
    dv.setUint16(o + 132, 128, true);
    dv.setUint16(o + 134, 160, true);
  });
  const tree = table(2, 20, (dv, b, o, i) => {
    dv.setInt32(o, 256 * 100 * (i + 1), true);
    dv.setInt32(o + 4, 256 * 5, true);
    dv.setInt32(o + 8, -256 * 3, true);
    dv.setUint16(o + 14, 16384, true);
    dv.setUint16(o + 16, 8192, true);
    b[o + 18] = 7; b[o + 19] = 1;
  });
  const gras = new Uint8Array(12 + 12 + 24);
  const g = new DataView(gras.buffer);
  g.setUint32(0, 2, true); g.setUint16(4, 12, true); g.setUint32(8, 1, true);
  g.setUint16(12, 9, true); g.setUint16(14, 11, true); g.setUint32(16, 0, true); g.setUint32(20, 2, true);
  const info = new TextEncoder().encode("name=Test\r\n");
  const veg = parseMveg(container("MVEG", [
    { id: "SPEC", bytes: spec }, { id: "TREE", bytes: tree }, { id: "GRAS", bytes: gras }, { id: "INFO", bytes: info },
  ], 3));
  assert.equal(veg.header.flags, 3);
  assert.equal(veg.species[0].model, "OAK.BIN");
  assert.equal(veg.species[0].farModel, "OAKFAR.BIN");
  assert.equal(veg.species[0].collide, 1);
  assert.equal(veg.species[0].trunkDiameterFeet, 2);
  assert.equal(veg.species[0].trunkHeightFeet, 10);
  assert.equal(veg.species[0].count, 2);
  assert.deepEqual(veg.trees[1], { x: 200, y: 5, z: -3, species: 0, heading: 0.25, scale: 2, tint: 7, tier: 1 });
  assert.equal(veg.clumps, 2);
  assert.deepEqual(veg.grassTiles, [{ tx: 9, tz: 11, first: 0, count: 2 }]);
  assert.equal(veg.info, "name=Test\r\n");
  assert.equal(veg.rule, null);
});

test("cp4: truncated chunk is refused", () => {
  const bytes = container("MWTR", [{ id: "TMAP", bytes: new Uint8Array(16) }]);
  assert.throws(() => parseMwtr(bytes.subarray(0, bytes.length - 4)), /runs past/);
});

test("cp4: 16-bit DATA heightmaps", () => {
  assert.deepEqual(heightmapRawLayout("DATA\\MYTRACK.RAW", 131072).interpretations, ["cp4", "cpr"]);
  assert.equal(heightmapRawLayout("data/MYTRACK.RAW", 2097152).side, 1024);
  assert.equal(heightmapRawLayout("ART\\MYTRACK.RAW", 131072), null);
  assert.equal(heightmapRawLayout("DATA\\MYTRACK.RAW", 65536), null);
  const bytes = new Uint8Array(131072);
  new DataView(bytes.buffer).setUint16(2, 1280, true);
  const { min, max } = readHeightSamples(bytes, 256);
  assert.equal(min, 0);
  assert.equal(max, 1280);
  assert.match(getRawDescription("MYTRACK.RAW", 131072, "DATA\\MYTRACK.RAW"), /^Height map \(256×256 u16/);
  assert.match(getRawDescription("MYTRACK.RAW", 2097152, "DATA\\MYTRACK.RAW"), /1024×1024/);
  assert.match(getRawDescription("MYTRACK.RAW", 131072, "ART\\MYTRACK.RAW"), /^RAW image data/);
});

test("cp4: type labels and PNG mask suffixes", () => {
  assert.equal(getFileTypeInfo("MUSIC\\TRACK1.OGG").description, "Ogg Vorbis music (CP4)");
  assert.equal(getFileTypeInfo("A.MP3").description, "MP3 music (CP4)");
  assert.equal(getFileTypeInfo("_DEFAULT_CP.CPT").description, "3D cockpit layout (CP4)");
  assert.equal(getFileTypeInfo("TRUCK.SRF").description, "Surface mesh materials (CP4)");
  assert.equal(getFileTypeInfo("LAKES.WTR").description, "Lakes / water bodies (CP4)");
  assert.match(getFileTypeInfo("BEST.GST").description, /MTM2GHOST 1/);
  assert.equal(getRawDescription("TRACK_V.PNG", 100), "PNG image (vegetation mask, trees)");
  assert.equal(getRawDescription("TRACK_G.PNG", 100), "PNG image (vegetation mask, grass)");
  assert.equal(getRawDescription("TRACK_H.PNG", 100), "PNG image (16-bit height map)");
  assert.equal(getHdMapRole("TRACK_H.RAW"), null);
  assert.equal(getHdMapRole("TRACK_N.PNG"), "normal map");
});
