import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { heightmapRawLayout, HEIGHTMAP_SCALES } from "../src/model/cp4-world.js";
import { getFileTypeInfo, getRawDescription, getHdMapRole } from "../src/file-type-info.js";
import {
  writeWtr, isWtr, isMtm2Veg, isWfl, parseWtr, parseMtm2Veg, vegTreeAt, parseWfl, writeWfl, decodeMtm2Heights,
  parsePod, findPodEntry, readPodEntry,
} from "../src/vendor/openphotex/index.js";
import { renderMwtr, renderMveg, renderMwfl, renderHeightmap } from "../src/preview/cp4-world-preview.js";

// Fila's beta 0.53 sandbox (fog_test.pod: two waterfalls, lakes, vegetation). Tests that read it
// skip when it is absent.
const SANDBOX_053 = process.env.JSPOD_CP4_053 ?? join(homedir(), "games", "cp4sandbox053", "fog_test.pod");

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

test("cp4: magic sniffing tells MWTR, MVEG and MWFL from Evo text", () => {
  const enc = (t) => new TextEncoder().encode(t);
  assert.equal(isWtr(enc("MWTR....")), true);
  assert.equal(isMtm2Veg(enc("MVEG")), true);
  assert.equal(isWfl(enc("MWFL")), true);
  for (const sniff of [isWtr, isMtm2Veg, isWfl]) {
    assert.equal(sniff(enc("tree oak 1 2 3")), false);
    assert.equal(sniff(new Uint8Array(2)), false);
  }
});

function wtrBytes() {
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
  return container("MWTR", [{ id: "BODY", bytes: body }, { id: "TMAP", bytes: tmap }]);
}

test("cp4: MWTR lakes and tile map through the vendored parseWtr", () => {
  const wtr = parseWtr(wtrBytes());
  assert.equal(wtr.lakes.length, 2);
  assert.equal(wtr.lakes[0].reflective, true);
  assert.equal(wtr.lakes[1].reflective, false);
  assert.equal(wtr.lakes[0].heightFt, 150.5);
  assert.deepEqual(wtr.lakes[0].seeds, [{ x: 10, z: 20 }, { x: 0, z: 0 }]);
  assert.deepEqual(wtr.lakes[1].box, { minX: 5, minZ: 6, maxX: 7, maxZ: 8 });
  assert.equal(wtr.lakes[1].tileCount, 43);
  assert.equal(wtr.tileMap[3 + 4 * 256], 2);
  assert.equal(wtr.tilesX, 256);
});

function vegBytes() {
  const spec = table(1, 192, (dv, b, o) => {
    b.set(new TextEncoder().encode("OAK.BIN"), o);
    b.set(new TextEncoder().encode("OAKFAR.BIN"), o + 64);
    b[o + 128] = 0; b[o + 129] = 1; b[o + 130] = 1 | 8;
    dv.setUint16(o + 132, 128, true);
    dv.setUint16(o + 134, 160, true);
    b.set(new TextEncoder().encode("Oak"), o + 148);
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
  const info = new TextEncoder().encode("tool=Test\r\ntrees=2\r\n");
  return container("MVEG", [
    { id: "SPEC", bytes: spec }, { id: "TREE", bytes: tree }, { id: "GRAS", bytes: gras }, { id: "INFO", bytes: info },
  ]);
}

test("cp4: MVEG species, trees, grass and INFO through the vendored parseMtm2Veg", () => {
  const veg = parseMtm2Veg(vegBytes());
  assert.equal(veg.species[0].model, "OAK.BIN");
  assert.equal(veg.species[0].farModel, "OAKFAR.BIN");
  assert.equal(veg.species[0].name, "Oak");
  assert.equal(veg.species[0].collide, 1);
  assert.equal(veg.species[0].trunkDiameter / 64, 2);
  assert.equal(veg.species[0].trunkHeight / 16, 10);
  assert.equal(veg.trees.count, 2);
  assert.deepEqual(vegTreeAt(veg.trees, 1), { x: 200, y: 5, z: -3, headingTurns: 0.25, scale: 2 });
  assert.equal(veg.trees.tier[1], 1);
  assert.equal(veg.clumps.count, 2);
  assert.deepEqual(veg.clumps.tiles, [{ tx: 9, tz: 11, first: 0, count: 2 }]);
  assert.deepEqual(veg.info, { tool: "Test", trees: "2" });
  assert.equal(veg.rule, null);
});

test("cp4: truncated or malformed sidecars are refused", () => {
  const wtr = wtrBytes();
  assert.throws(() => parseWtr(wtr.subarray(0, 40)), RangeError);
  const veg = vegBytes();
  assert.throws(() => parseMtm2Veg(veg.subarray(0, 20)), RangeError);
});

const FALLS = [
  {
    source: 2, flags: 7, speed: 96, height: 648, opacity: 100, mist: 90, volume: 100, mistDepth: 100, mistHeight: 30,
    points: [{ x: 60432, z: 76800 }, { x: 61936, z: 76800 }], soundName: "", textureName: "",
  },
  {
    // A spring whose crest crosses the world edge at x = 8192 ft (131072 sixteenths).
    source: 0, flags: 2, speed: 64, height: 751, opacity: 80, mist: 0, volume: 50,
    points: [{ x: 131072 - 160, z: 1600 }, { x: 160, z: 1600 }, { x: 160, z: 1600 + 480 }],
    soundName: "RIVER", textureName: "FALLTEX",
  },
];

test("cp4: MWFL v1.1 waterfalls written by writeWfl read back through parseWfl", () => {
  const bytes = writeWfl(FALLS);
  assert.equal(isWfl(bytes), true);
  const wfl = parseWfl(bytes);
  assert.equal(wfl.major, 1);
  assert.equal(wfl.minor, 1);
  assert.equal(wfl.stride, 132);
  assert.equal(wfl.falls.length, 2);
  const [lake, spring] = wfl.falls;
  assert.equal(lake.source, 2);
  assert.equal(lake.heightFt, 324);
  assert.equal(lake.speedFtPerSec, 6);
  assert.equal(lake.mistHeight, 30);
  assert.deepEqual([lake.freeze, lake.splash, lake.sound], [true, true, true]);
  assert.equal(spring.source, 0);
  assert.deepEqual([spring.freeze, spring.splash, spring.sound], [false, true, false]);
  assert.equal(spring.soundName, "RIVER");
  assert.equal(spring.textureName, "FALLTEX");
  assert.equal(spring.points.length, 3);
});

test("cp4: MWFL v1.0 when every mist size is the default, and refusals", () => {
  const plain = FALLS.map((f) => ({ ...f, mistDepth: 100, mistHeight: 0 }));
  const wfl = parseWfl(writeWfl(plain));
  assert.equal(wfl.minor, 0);
  assert.equal(wfl.stride, 128);
  assert.equal(wfl.falls[0].mistHeight, 100);
  const bad = writeWfl(plain);
  bad[32 + 16 + 8 + 2] = 1; // first fall's point count
  assert.throws(() => parseWfl(bad), /points/);
  const major = writeWfl(plain);
  major[4] = 3;
  assert.throws(() => parseWfl(major), /major/);
});

// A tiny stand-in for the DOM, enough for the CP4 previews to run under node --test.
function fakeDom() {
  const ctx = new Proxy({}, {
    get: (t, k) => k in t ? t[k] : k === "createImageData" ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {},
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const el = (tag) => {
    const node = {
      tag, children: [], style: {}, className: "", textContent: "",
      append: (...c) => node.children.push(...c), appendChild: (c) => node.children.push(c),
      replaceChildren: (...c) => { node.children = c; }, addEventListener: () => {}, getContext: () => ctx,
    };
    return node;
  };
  return { createElement: el };
}

function text(node) {
  return [node.textContent, ...(node.children ?? []).map(text)].join(" ");
}

test("cp4: previews render WTR, VEG, WFL and a heightmap through the vendor", () => {
  const saved = globalThis.document;
  globalThis.document = fakeDom();
  try {
    const box = document.createElement("div");
    renderMwtr(box, wtrBytes());
    assert.match(text(box), /MWTR 1\.0 · 256×256 tiles · 2 lakes/);
    renderMveg(box, vegBytes());
    assert.match(text(box), /MVEG 1\.0 · 1 species · 2 trees · 2 grass clumps in 1 tiles/);
    assert.match(text(box), /tool=Test/);
    renderMwfl(box, writeWfl(FALLS));
    const out = text(box);
    assert.match(out, /MWFL 1\.1 · stride 132 bytes · 2 falls/);
    assert.match(out, /Lake 2/);
    assert.match(out, /Spring/);
    assert.match(out, /94\.0/); // the lake fall's crest: 1504 sixteenths
    assert.match(out, /50\.0/); // the spring's crest: 20 ft across the edge, then 30 ft
    assert.match(out, /freeze, splash, sound/);
    assert.match(out, /RIVER/);
    assert.match(out, /\(default\)/);
    // Track format version 6: a .WFL version 2 on a 512-cell world, a crest beyond 8192 ft, and a version 2 .WTR map.
    renderMwfl(box, writeWfl([{ source: 0, flags: 0, speed: 64, height: 3000, points: [{ x: 12000 * 16, z: 100 * 16 }, { x: 12040 * 16, z: 100 * 16 }], opacity: 100, mist: 0, volume: 0 }], { cells: 512 }));
    assert.match(text(box), /MWFL 2\.0 · stride 128 bytes · 1 fall · 512×512 cells/);
    assert.match(text(box), /16384 ft square/);
    assert.match(text(box), /1500\.0/);
    const tmap512 = new Uint8Array(512 * 512);
    tmap512[300 * 512 + 400] = 1;
    renderMwtr(box, writeWtr([{ flags: 0, height: 3000, seeds: [{ x: 400, z: 300 }], box: { minX: 400, minZ: 300, maxX: 400, maxZ: 300 }, tileCount: 1 }], tmap512));
    assert.match(text(box), /MWTR 2\.0 · 512×512 tiles · 1 lake/);
    const raw = new Uint8Array(131072);
    new DataView(raw.buffer).setUint16(2, 1280, true);
    renderHeightmap(box, raw, heightmapRawLayout("DATA\\T.RAW", raw.length));
    assert.match(text(box), /max 10\.00 ft/);
  } finally {
    globalThis.document = saved;
  }
});

test("cp4: 16-bit DATA heightmaps", () => {
  assert.deepEqual(heightmapRawLayout("DATA\\MYTRACK.RAW", 131072).interpretations, ["cp4", "cpr"]);
  assert.equal(heightmapRawLayout("data/MYTRACK.RAW", 2097152).side, 1024);
  assert.equal(heightmapRawLayout("ART\\MYTRACK.RAW", 131072), null);
  assert.equal(heightmapRawLayout("DATA\\MYTRACK.RAW", 65536), null);
  assert.equal(HEIGHTMAP_SCALES.cp4.divisor, 128);
  assert.equal(HEIGHTMAP_SCALES.cpr.divisor, 16);
  assert.equal(HEIGHTMAP_SCALES.cpr.label, "CPR (feet = v / 16)");
  const bytes = new Uint8Array(131072);
  new DataView(bytes.buffer).setUint16(2, 1280, true);
  assert.equal(decodeMtm2Heights(bytes).coarse[1], 1280);
  assert.equal(decodeMtm2Heights(new Uint8Array(2097152)).fine.length, 1024 * 1024);
  assert.match(getRawDescription("MYTRACK.RAW", 131072, "DATA\\MYTRACK.RAW"), /^Height map \(256×256 u16/);
  assert.match(getRawDescription("MYTRACK.RAW", 2097152, "DATA\\MYTRACK.RAW"), /1024×1024/);
  assert.match(getRawDescription("MYTRACK.RAW", 131072, "ART\\MYTRACK.RAW"), /^RAW image data/);
});

test("cp4: beta 0.53 sandbox pod: WFL, WTR and VEG", { skip: !existsSync(SANDBOX_053) && `no ${SANDBOX_053}` }, () => {
  const pod = new Uint8Array(readFileSync(SANDBOX_053));
  const archive = parsePod(pod);
  const entry = (name) => readPodEntry(pod, findPodEntry(archive, `WORLD\\${name}`));
  const wfl = parseWfl(entry("FOGTEST.WFL"));
  assert.deepEqual([wfl.major, wfl.minor, wfl.stride, wfl.falls.length], [1, 1, 132, 2]);
  assert.deepEqual(wfl.falls.map((f) => f.source), [2, 0]);
  assert.deepEqual(wfl.falls.map((f) => f.heightFt), [324, 375.5]);
  assert.equal(wfl.falls[0].mistHeight, 30);
  const wtr = parseWtr(entry("FOGTEST.WTR"));
  assert.equal(wtr.lakes.length, 2);
  assert.equal(wtr.lakes[wfl.falls[0].source - 1].heightFt, wfl.falls[0].heightFt);
  const veg = parseMtm2Veg(entry("FOGTEST.VEG"));
  assert.equal(veg.species.length, 4);
  assert.equal(veg.trees.count, 12394);
  assert.equal(veg.info.toolVersion, "1.7.1");
});

test("cp4: type labels and PNG mask suffixes", () => {
  assert.equal(getFileTypeInfo("MUSIC\\TRACK1.OGG").description, "Ogg Vorbis music (CP4)");
  assert.equal(getFileTypeInfo("A.MP3").description, "MP3 music (CP4)");
  assert.equal(getFileTypeInfo("_DEFAULT_CP.CPT").description, "3D cockpit layout (CP4)");
  assert.equal(getFileTypeInfo("TRUCK.SRF").description, "Surface mesh materials (CP4)");
  assert.equal(getFileTypeInfo("LAKES.WTR").description, "Lakes / water bodies (CP4)");
  assert.equal(getFileTypeInfo("WORLD\\FOGTEST.WFL").description, "Waterfalls (CP4 beta 0.53)");
  assert.match(getFileTypeInfo("BEST.GST").description, /MTM2GHOST 1/);
  assert.equal(getRawDescription("TRACK_V.PNG", 100), "PNG image (vegetation mask, trees)");
  assert.equal(getRawDescription("TRACK_G.PNG", 100), "PNG image (vegetation mask, grass)");
  assert.equal(getRawDescription("TRACK_H.PNG", 100), "PNG image (16-bit height map)");
  assert.equal(getHdMapRole("TRACK_H.RAW"), null);
  assert.equal(getHdMapRole("TRACK_N.PNG"), "normal map");
});
