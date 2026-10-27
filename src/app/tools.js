/*
  The Tools menu: Validate, POD2 audit history, .inf/.lst reports and Mount in pod.ini.
  Each takes the PodApp. Behaviour follows KPod's MainForm.
*/
import { alertDialog, confirmDialog, openDialog, promptDialog, reportDialog } from "../ui/dialogs.js";
import { validateDocument, validateOpened } from "../model/validate.js";
import { infoReport, listReport } from "../model/reports.js";
import { AlreadyMountedError, mountInPodIni as mountText } from "../model/pod-ini.js";
import { hasDirectoryAccess, pickWritableDirectory } from "./disk.js";
import { saveTextAs } from "./save-text.js";

/** Checks an unchanged archive as read (including POD2 CRCs), or an edited one as Save would. */
export async function validate(app) {
  const doc = app.doc;
  if (doc.dirty || !app.podIndex) {
    const report = validateDocument(doc, { forSave: true });
    return reportDialog("Validate", { ...report, ok: `No problems found. The archive can be saved as ${doc.outputFormat.toUpperCase()}.` });
  }
  const report = await app.withBusy("Validating...", async () => {
    const result = validateOpened(app.podIndex);
    const layout = validateDocument(doc, { forSave: true });
    for (const message of layout.errors) if (!result.errors.includes(message)) result.errors.push(message);
    if (app.podIndex.format === "pod2") {
      const crc = await app.workerClient.call("verifyChecksums", { opfsPodPath: app.archivePath });
      if (crc) {
        for (const m of crc.mismatches) result.errors.push(`POD2 entry checksum mismatch: ${m.name}`);
        if (!crc.archive.ok) result.errors.push("POD2 archive checksum mismatch");
      }
    }
    return result;
  });
  if (!report) return;
  await reportDialog("Validate", {
    ...report,
    ok: `No problems found in ${doc.sourceName}${app.podIndex.format === "pod2" ? " (every CRC matches)" : ""}.`,
  });
}

export async function auditHistory(app) {
  const doc = app.doc;
  let records = [];
  if (doc.auditTrail) {
    records = await app.withBusy("Reading audit history...", () => app.workerClient.call("readAuditTrail", doc.auditTrail)) ?? [];
  }
  const rows = [
    ...records.map((r) => ({ ...r, action: r.action ?? `code ${r.actionCode}`, unsaved: false })),
    ...doc.auditAdded.map((r) => ({ ...r, unsaved: true })),
  ];
  const body = document.createElement("div");
  const note = document.createElement("p");
  note.className = "modal-hint";
  note.textContent = doc.outputFormat === "pod2"
    ? `${rows.length} records. Records marked "unsaved" are written on the next save. Recording is ${doc.auditEnabled ? "on" : "off"} (Tools menu).`
    : `${rows.length} records. The archive will be saved as POD1, which has no audit history, so none of them will be written.`;
  body.appendChild(note);
  if (rows.length) {
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "data-table";
    const head = table.createTHead().insertRow();
    for (const h of ["Time", "User", "Action", "Entry", "Old size", "New size", ""]) head.insertCell().textContent = h;
    const tbody = table.createTBody();
    for (const r of rows.slice(-5000)) {
      const tr = tbody.insertRow();
      tr.insertCell().textContent = r.timestamp ? new Date(r.timestamp * 1000).toLocaleString() : "";
      tr.insertCell().textContent = r.user;
      tr.insertCell().textContent = r.action;
      tr.insertCell().textContent = r.path;
      tr.insertCell().textContent = r.oldSize ? r.oldSize.toLocaleString() : "";
      tr.insertCell().textContent = r.newSize ? r.newSize.toLocaleString() : "";
      tr.insertCell().textContent = r.unsaved ? "unsaved" : "";
    }
    wrap.appendChild(table);
    body.appendChild(wrap);
  }
  return openDialog({ title: "POD2 Audit History", body, wide: true });
}

/** KPod writes reports for an archive opened from disk; here, for the saved state. */
async function requireSaved(app, what) {
  if (app.podIndex && !app.doc.dirty) return true;
  await alertDialog(what, "Save the archive first: the report describes the archive as saved (sizes and offsets).");
  return false;
}

export async function saveInfo(app) {
  if (!(await requireSaved(app, "Save .inf Report"))) return;
  const archive = { comment: app.doc.comment, entries: app.doc.entries };
  const text = infoReport(archive, app.doc.sourceName, app.podIndex.byteLength);
  await saveTextAs(text, app.doc.sourceName.replace(/\.[^.]*$/, "") + ".inf", ".inf");
}

export async function saveList(app) {
  if (!(await requireSaved(app, "Save .lst List"))) return;
  const text = listReport({ entries: app.doc.entries });
  await saveTextAs(text, app.doc.sourceName.replace(/\.[^.]*$/, "") + ".lst", ".lst");
}

/**
 * Adds the archive to the game's pod.ini. Needs a writable folder, so Chromium only. KPod also
 * looks one folder up; a browser can only see the folder the user picks, so pick the one with
 * pod.ini in it.
 */
export async function mountInPodIni(app) {
  if (!hasDirectoryAccess) {
    await alertDialog("Mount in pod.ini", "Mounting needs write access to the game folder, which only Chromium browsers (Chrome, Edge) allow. Add the line to pod.ini by hand: increase the number on line 1 and add the POD's file name at the end.");
    return;
  }
  if (app.doc.dirty) {
    const ok = await confirmDialog("Mount in pod.ini", "The archive has unsaved changes. Mount it anyway? (The game reads the file on disk, not these changes.)", { okLabel: "Mount" });
    if (!ok) return;
  }
  const label = await promptDialog("Mount in pod.ini", "pod.ini line for this POD:", app.doc.sourceName, {
    hint: "Usually the POD's file name. A POD in a subfolder can be mounted as SUBFOLDER\\NAME.POD.",
    validate: (v) => (v.trim() ? null : "Enter the POD's name."),
  });
  if (!label) return;
  const dir = await pickWritableDirectory("jspod-game");
  if (!dir) return;
  let iniHandle;
  try {
    iniHandle = await dir.getFileHandle("pod.ini");
  } catch {
    await alertDialog("pod.ini not found", `There is no pod.ini in ${dir.name}. Pick the game folder that holds pod.ini.`);
    return;
  }
  const text = await (await iniHandle.getFile()).text();
  let result;
  try {
    result = mountText(text, label.trim());
  } catch (error) {
    if (error instanceof AlreadyMountedError) {
      await alertDialog("Already mounted", error.message);
      return;
    }
    throw error;
  }
  const bytes = new TextEncoder().encode(result.text);
  // Through pod.wrk first, as KPod does, so a failed write never leaves pod.ini half written.
  const work = await dir.getFileHandle("pod.wrk", { create: true });
  let writable = await work.createWritable();
  await writable.write(bytes);
  await writable.close();
  writable = await iniHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
  await dir.removeEntry("pod.wrk").catch(() => {});
  app.setStatus(`Mounted ${label.trim()} in ${dir.name}\\pod.ini.`);
  if (result.limitExceeded) {
    await alertDialog("Mounted", `${label.trim()} was mounted, but pod.ini already had 99 or more PODs. The game may not load all of them.`);
  }
}

