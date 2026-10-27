import test from "node:test";
import assert from "node:assert/strict";
import { parsePod, readPodEntry, readPod2AuditTrail, verifyPodChecksums, writePod2, writePod1 } from "../src/vendor/openphotex/index.js";
import { writeArchive } from "../src/worker/pod-writer.js";

const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** In-memory stand-in for OPFS. */
function memoryIo(files) {
  return {
    async readFile(path) {
      if (!files.has(path)) throw new Error(`no ${path}`);
      return new Blob([files.get(path)]);
    },
    async openFileWriter(path) {
      let out = new Uint8Array(0);
      return {
        async write(bytes, at) {
          if (at + bytes.length > out.length) { const grown = new Uint8Array(at + bytes.length); grown.set(out); out = grown; }
          out.set(bytes, at);
        },
        async close() { files.set(path, out); },
      };
    },
  };
}

test("POD2 from mixed sources, existing and new audit records, verifies", async () => {
  const original = writePod2("Old", [
    { name: "A.TXT", data: latin1("alpha"), timestamp: 5 },
    { name: "B.TXT", data: latin1("beta"), timestamp: 6 },
  ], [{ user: "david", timestamp: 1, action: "add", path: "A.TXT", newSize: 5 }]);
  const pod = parsePod(original);
  const files = new Map([["archive.pod", original], ["blobs/1", latin1("new data")]]);
  const io = memoryIo(files);
  const trailLength = 312;
  await writeArchive({
    outPath: "out.pod",
    format: "pod2",
    comment: "New comment",
    rawComment: null,
    entries: [
      { name: "B.TXT", length: 4, timestamp: 6, paletteName: null, source: { kind: "archive", path: "archive.pod", offset: pod.entries[1].offset, length: 4 } },
      { name: "DATA\\C.BIN", length: 8, timestamp: null, paletteName: null, source: { kind: "blob", path: "blobs/1" } },
    ],
    auditTrail: { path: "archive.pod", offset: original.length - trailLength, length: trailLength, count: 1 },
    auditAdded: [{ user: "jspod", timestamp: 2, action: "remove", path: "A.TXT", oldSize: 5 }],
    now: 777,
  }, () => {}, io);
  const out = files.get("out.pod");
  const written = parsePod(out);
  assert.equal(written.comment, "New comment");
  assert.deepEqual(written.entries.map((e) => [e.name, e.timestamp]), [["B.TXT", 6], ["DATA\\C.BIN", 777]]);
  assert.deepEqual(readPodEntry(out, written.entries[1]), latin1("new data"));
  const report = verifyPodChecksums(out, written);
  assert.ok(report.archive.ok);
  assert.deepEqual(report.mismatches, []);
  assert.deepEqual(readPod2AuditTrail(out, written).map((r) => [r.user, r.action, r.path]), [["david", "add", "A.TXT"], ["jspod", "remove", "A.TXT"]]);
});

test("rewriting an unchanged POD2 with its raw comment reproduces it byte for byte", async () => {
  const raw = new Uint8Array(80);
  raw.set(latin1("Spaced "));
  const original = writePod2(raw, [{ name: "A", data: latin1("aa"), timestamp: 3 }], [{ user: "u", timestamp: 1, action: 0, path: "A", newSize: 2 }]);
  const pod = parsePod(original);
  const files = new Map([["a.pod", original]]);
  await writeArchive({
    outPath: "o.pod", format: "pod2", comment: pod.comment, rawComment: original.slice(8, 88),
    entries: pod.entries.map((e) => ({ ...e, source: { kind: "archive", path: "a.pod", offset: e.offset, length: e.length } })),
    auditTrail: { path: "a.pod", offset: original.length - 312, length: 312, count: 1 }, auditAdded: [], now: 0,
  }, () => {}, memoryIo(files));
  assert.deepEqual(files.get("o.pod"), original);
});

test("POD1 keeps palette records; large entries stream in chunks", async () => {
  const big = new Uint8Array((9 << 20) + 3).map((_, i) => i & 0xff);
  const files = new Map([["blobs/big", big], ["blobs/raw", new Uint8Array(4096).fill(1)]]);
  await writeArchive({
    outPath: "o.pod", format: "pod1", comment: "MTM2", rawComment: null,
    entries: [
      { name: "ART\\T.RAW", length: 4096, timestamp: null, paletteName: "METALCR2.ACT", source: { kind: "blob", path: "blobs/raw" } },
      { name: "BIG.BIN", length: big.length, timestamp: null, paletteName: null, source: { kind: "blob", path: "blobs/big" } },
    ],
    auditTrail: null, auditAdded: [], now: 0,
  }, () => {}, memoryIo(files));
  const out = files.get("o.pod");
  assert.deepEqual(out, writePod1("MTM2", [
    { name: "ART\\T.RAW", data: files.get("blobs/raw"), paletteName: "METALCR2.ACT" },
    { name: "BIG.BIN", data: big },
  ]));
});

test("a staged blob of the wrong size is refused", async () => {
  const files = new Map([["blobs/x", latin1("abc")]]);
  await assert.rejects(writeArchive({
    outPath: "o.pod", format: "pod1", comment: "", rawComment: null,
    entries: [{ name: "X", length: 4, timestamp: null, paletteName: null, source: { kind: "blob", path: "blobs/x" } }],
    auditTrail: null, auditAdded: [], now: 0,
  }, () => {}, memoryIo(files)), /expected 4/);
});
