import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, cycleSort, allFolderKeys } from "../src/model/browser.js";
import { findEntries, stepIndex } from "../src/model/search.js";
import { parseResponseList, resolveCandidates } from "../src/model/response-list.js";
import { infoReport, listReport } from "../src/model/reports.js";
import { mountInPodIni, AlreadyMountedError } from "../src/model/pod-ini.js";
import { validateDocument, validateOpened } from "../src/model/validate.js";
import { disabledName, enabledName } from "../src/model/disable.js";
import { pathProblem } from "../src/model/paths.js";
import { doc } from "./helpers.js";

test("rows: folders first, collapsed folders hide children, filter ignores collapse", () => {
  const d = doc(["Z.TXT", "ART\\B.RAW", "ART\\A.RAW", "DATA\\X.SIT"]);
  d.folders.add("EMPTY");
  const rows = buildRows(d);
  assert.deepEqual(rows.map((r) => r.kind === "folder" ? `[${r.label}]` : r.entry.title), ["[ART]", "B.RAW", "A.RAW", "[DATA]", "X.SIT", "[EMPTY]", "Z.TXT"]);
  const collapsed = buildRows(d, { collapsed: allFolderKeys(d) });
  assert.deepEqual(collapsed.map((r) => r.kind === "folder" ? `[${r.label}]` : r.entry.title), ["[ART]", "[DATA]", "[EMPTY]", "Z.TXT"]);
  const filtered = buildRows(d, { collapsed: allFolderKeys(d), filter: "a.raw" });
  assert.deepEqual(filtered.map((r) => r.kind === "folder" ? `[${r.label}]` : r.entry.title), ["[ART]", "A.RAW"]);
  assert.equal(rows[0].count, 2);
});

test("sort cycles asc, desc, archive order", () => {
  let s = cycleSort(null, "name");
  assert.deepEqual(s, { column: "name", dir: "asc" });
  s = cycleSort(s, "name");
  assert.equal(s.dir, "desc");
  assert.equal(cycleSort(s, "name"), null);
  const d = doc(["B.TXT", "A.TXT", "C.TXT"]);
  assert.deepEqual(buildRows(d, { sort: { column: "name", dir: "asc" } }).map((r) => r.entry.title), ["A.TXT", "B.TXT", "C.TXT"]);
  assert.deepEqual(buildRows(d, { sort: { column: "size", dir: "desc" } }).map((r) => r.entry.title), ["C.TXT", "A.TXT", "B.TXT"]);
});

test("search by name and size, with wrap-around stepping", () => {
  const d = doc(["ART\\ROCK.RAW", "art\\tree.raw", "DATA\\X.SIT"]);
  assert.equal(findEntries(d.entries, { text: "art" }).length, 2);
  assert.equal(findEntries(d.entries, { text: "art", matchCase: true }).length, 1);
  assert.equal(findEntries(d.entries, { text: "12", names: false, sizes: true })[0].title, "X.SIT");
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(-1, 3, -1), 2);
});

test("response list parsing and lookup order", () => {
  const list = parseResponseList("// comment\r\npodFilename: TRACK.POD\nvolumeName: My Track\n\nart\\rock.raw\nsrc.sit , data\\track.sit\n");
  assert.equal(list.podFilename, "TRACK.POD");
  assert.equal(list.volumeName, "My Track");
  assert.deepEqual(list.items, [{ file: "art\\rock.raw", entryName: "ART\\ROCK.RAW" }, { file: "src.sit", entryName: "DATA\\TRACK.SIT" }]);
  assert.deepEqual(resolveCandidates("lists/a", "x\\y.raw"), ["lists/a/x/y.raw", "lists/x/y.raw"]);
  assert.deepEqual(resolveCandidates("", "y.raw"), ["y.raw"]);
});

test(".inf and .lst reports keep KPod's columns and CRLF", () => {
  const archive = { comment: "T", entries: [{ name: "ART\\A.RAW", length: 4096, offset: 124 }, { name: "X".repeat(31), length: 1, offset: 4220 }] };
  const inf = infoReport(archive, "T.POD", 4221).split("\r\n");
  assert.equal(inf[0], "Pod Filename = T.POD");
  assert.equal(inf[6], "ART\\A.RAW" + " ".repeat(21) + "4096" + " ".repeat(11) + "124");
  assert.equal(inf[7], "X".repeat(31) + " 1" + " ".repeat(12) + "4220");
  assert.equal(listReport(archive), "ART\\A.RAW\r\n" + "X".repeat(31) + "\r\n");
});

test("pod.ini mount: count, no duplicates, CRLF, the 99 warning", () => {
  assert.deepEqual(mountInPodIni("2\nA.POD\nB.POD\n", "C.POD"), { text: "3\r\nA.POD\r\nB.POD\r\nC.POD\r\n", limitExceeded: false });
  assert.throws(() => mountInPodIni("1\r\nc.pod\r\n", "C.POD"), AlreadyMountedError);
  assert.equal(mountInPodIni("", "A.POD").text, "1\r\nA.POD\r\n");
  assert.equal(mountInPodIni("99\n", "A.POD").limitExceeded, true);
});

test("validation: unsafe paths, empty archive on save, opened-archive checks", () => {
  for (const bad of ["\\A", "A\\", "C:\\A", "A\\\\B", "A\\..\\B", "A\\.\\B", ""]) assert.ok(pathProblem(bad), bad);
  assert.equal(pathProblem("ART\\A.RAW"), null);
  assert.deepEqual(validateDocument(doc([]), { forSave: true }).errors, ["The archive is empty. Add files first."]);
  const opened = validateOpened({
    entries: [
      { name: "A", normalizedName: "A", offset: 100, length: 10, paletteName: "X.BMP" },
      { name: "a", normalizedName: "A", offset: 105, length: 10, paletteName: null },
    ],
  });
  assert.equal(opened.errors.length, 2);
  assert.equal(opened.warnings.length, 1);
});

test("disable names", () => {
  assert.equal(disabledName("A.TrK"), "A.TRX");
  assert.equal(disabledName("a.trk"), "a.trx");
  assert.equal(enabledName("A.SIY"), "A.SI2");
  assert.equal(disabledName("A.RAW"), null);
});
