import test from "node:test";
import assert from "node:assert/strict";
import { History } from "../src/model/history.js";
import { addEntries, createFolder, moveEntries, removeEntries, renameEntry, renameFolder, replaceEntry, setComment, setDisabled } from "../src/model/edits.js";
import { EditRejected } from "../src/model/validate.js";
import { blob, doc } from "./helpers.js";

const names = (d) => d.entries.map((e) => e.name);

test("add, then undo and redo", () => {
  const d = doc(["ART\\A.RAW"]);
  const h = new History();
  h.run(d, "Add", (x) => addEntries(x, [blob("DATA\\B.SIT", 5)]));
  assert.deepEqual(names(d), ["ART\\A.RAW", "DATA\\B.SIT"]);
  assert.ok(d.dirty);
  h.undo(d);
  assert.deepEqual(names(d), ["ART\\A.RAW"]);
  assert.ok(!d.dirty, "undo back to the saved state is clean");
  h.redo(d);
  assert.deepEqual(names(d), ["ART\\A.RAW", "DATA\\B.SIT"]);
});

test("adding an existing name replaces it only when confirmed, in place", () => {
  const d = doc(["A.TXT", "B.TXT"]);
  const h = new History();
  assert.equal(h.run(d, "Add", (x) => addEntries(x, [blob("a.txt", 99)], { replace: () => false })), false);
  assert.equal(h.canUndo, false);
  h.run(d, "Add", (x) => addEntries(x, [blob("a.txt", 99)], { replace: () => true }));
  assert.deepEqual(names(d), ["a.txt", "B.TXT"]);
  assert.equal(d.entries[0].length, 99);
});

test("audit: add, change, and a rename logged as remove plus add", () => {
  const d = doc(["DATA\\T.SIT"]);
  const h = new History();
  h.run(d, "Add", (x) => addEntries(x, [blob("X.TXT", 3, { timestamp: 7 })]));
  h.run(d, "Replace", (x) => replaceEntry(x, x.entries[1].id, { length: 4, source: { kind: "blob", path: "p" }, timestamp: 8 }));
  h.run(d, "Rename", (x) => renameEntry(x, x.entries[1].id, "Y.TXT"));
  assert.deepEqual(d.auditAdded.map((r) => [r.action, r.path, r.oldSize, r.newSize]), [
    ["add", "X.TXT", 0, 3], ["change", "X.TXT", 3, 4], ["remove", "X.TXT", 4, 0], ["add", "Y.TXT", 0, 4],
  ]);
  h.undo(d);
  assert.equal(d.auditAdded.length, 2, "undo removes the audit records too");
  d.auditEnabled = false;
  h.run(d, "Rename", (x) => renameEntry(x, x.entries[1].id, "Z.TXT"));
  assert.equal(d.auditAdded.length, 2);
});

test("rename refuses paths and duplicates, and leaves the document unchanged", () => {
  const d = doc(["A\\X.TXT", "A\\Y.TXT"]);
  const h = new History();
  assert.throws(() => h.run(d, "Rename", (x) => renameEntry(x, x.entries[0].id, "B\\Z")), /not a path/);
  assert.throws(() => h.run(d, "Rename", (x) => renameEntry(x, x.entries[0].id, "y.txt")), EditRejected);
  assert.deepEqual(names(d), ["A\\X.TXT", "A\\Y.TXT"]);
  assert.equal(h.canUndo, false);
});

test("the POD1 31-byte name budget rejects an edit, POD2 allows it", () => {
  const long = "Q".repeat(40) + ".TXT";
  const d = doc(["A.TXT"]);
  const h = new History();
  assert.throws(() => h.run(d, "Rename", (x) => renameEntry(x, x.entries[0].id, long)), EditRejected);
  d.outputFormat = "pod2";
  h.run(d, "Rename", (x) => renameEntry(x, x.entries[0].id, long));
  assert.equal(d.entries[0].name, long);
});

test("an archive that arrived with duplicates can still be edited", () => {
  const d = doc(["A.TXT", "a.txt", "B.TXT"]);
  const h = new History();
  h.run(d, "Rename", (x) => renameEntry(x, x.entries[2].id, "C.TXT"));
  assert.deepEqual(names(d), ["A.TXT", "a.txt", "C.TXT"]);
});

test("folder rename and move carry everything inside; a folder cannot move into itself", () => {
  const d = doc(["ART\\A.RAW", "ART\\SUB\\B.RAW", "DATA\\C.SIT"]);
  const h = new History();
  h.run(d, "Rename folder", (x) => renameFolder(x, "ART", "TEX"));
  assert.deepEqual(names(d), ["TEX\\A.RAW", "TEX\\SUB\\B.RAW", "DATA\\C.SIT"]);
  h.run(d, "Move", (x) => moveEntries(x, [], ["TEX\\SUB"], "DATA"));
  assert.deepEqual(names(d), ["TEX\\A.RAW", "DATA\\SUB\\B.RAW", "DATA\\C.SIT"]);
  h.run(d, "Move", (x) => moveEntries(x, [x.entries[2].id], [], ""));
  assert.deepEqual(names(d), ["TEX\\A.RAW", "DATA\\SUB\\B.RAW", "C.SIT"]);
  assert.throws(() => h.run(d, "Move", (x) => moveEntries(x, [], ["DATA"], "DATA\\SUB")), /into itself/);
});

test("remove a folder removes its subtree and explicit folders", () => {
  const d = doc(["ART\\A.RAW", "ART\\SUB\\B.RAW", "C.SIT"]);
  const h = new History();
  h.run(d, "Folder", (x) => createFolder(x, "ART", "EMPTY"));
  assert.throws(() => h.run(d, "Folder", (x) => createFolder(x, "", "art")), /already exists/);
  h.run(d, "Remove", (x) => removeEntries(x, [], ["ART"]));
  assert.deepEqual(names(d), ["C.SIT"]);
  assert.equal(d.folders.size, 0);
});

test("disable and enable keep case and skip other entries", () => {
  const d = doc(["TRUCK\\BIG.TRK", "track.sit", "X.SI2", "Z.SI3", "Y.RAW"]);
  const h = new History();
  h.run(d, "Disable", (x) => setDisabled(x, x.entries.map((e) => e.id), true));
  assert.deepEqual(names(d), ["TRUCK\\BIG.TRX", "track.six", "X.SIY", "Z.SIZ", "Y.RAW"]);
  h.run(d, "Enable", (x) => setDisabled(x, x.entries.map((e) => e.id), false));
  assert.deepEqual(names(d), ["TRUCK\\BIG.TRK", "track.sit", "X.SI2", "Z.SI3", "Y.RAW"]);
});

test("comment: 79 bytes and windows-1252 only", () => {
  const d = doc(["A"]);
  const h = new History();
  h.run(d, "Comment", (x) => setComment(x, "My Track"));
  assert.equal(d.comment, "My Track");
  assert.throws(() => h.run(d, "Comment", (x) => setComment(x, "c".repeat(80))), EditRejected);
  assert.throws(() => h.run(d, "Comment", (x) => setComment(x, "雪")), EditRejected);
});

test("the raw comment field is written back only while the comment is unchanged", () => {
  const raw = new Uint8Array(80);
  const d = doc(["A"], { comment: "Con", rawComment: raw });
  assert.equal(d.commentForWrite(), raw);
  d.comment = "Other";
  assert.equal(d.commentForWrite(), "Other");
});

test("switching a POD1 to POD2 output is an unsaved change; an EPD is not", async () => {
  const { PodDocument } = await import("../src/model/pod-document.js");
  const pod1 = new PodDocument({ format: "pod1" });
  assert.ok(!pod1.dirty);
  pod1.outputFormat = "pod2";
  assert.ok(pod1.dirty);
  const epd = new PodDocument({ format: "epd" });
  assert.equal(epd.outputFormat, "pod1");
  assert.ok(!epd.dirty);
});

test("documentFromArchive keeps offsets, timestamps, CRCs and the audit trail location", async () => {
  const { documentFromArchive } = await import("../src/model/pod-document.js");
  const { parsePod, writePod2 } = await import("../src/vendor/openphotex/index.js");
  const bytes = writePod2("T", [{ name: "A\\B.TXT", data: new Uint8Array([1, 2, 3]), timestamp: 9 }], [{ user: "u", timestamp: 1, action: "add", path: "A\\B.TXT", newSize: 3 }]);
  const d = documentFromArchive(parsePod(bytes), { path: "x.pod", sourceName: "T.POD", rawComment: bytes.slice(8, 88) });
  assert.equal(d.format, "pod2");
  assert.equal(d.outputFormat, "pod2");
  assert.deepEqual(d.auditTrail, { path: "x.pod", offset: bytes.length - 312, length: 312, count: 1 });
  const [e] = d.entries;
  assert.equal(e.timestamp, 9);
  assert.deepEqual(e.source, { kind: "archive", path: "x.pod", offset: e.offset, length: 3 });
  assert.equal(d.projectedSize(), bytes.length);
});
