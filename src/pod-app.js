/*
  JSPod's controller: the open document, the entry list, the preview, menus and commands.

  The archive being edited is a PodDocument (src/model/pod-document.js). Opened archives,
  added files and edited entries are staged in OPFS under sessions/jspod/, so memory use stays
  flat whatever the archive size; the worker reads and writes them there. Every edit goes
  through History (undo/redo, validation). Save writes a new archive into OPFS with the worker,
  hands it to the user (save in place, a save picker, or a download), then reopens it.
*/
import { WorkerClient } from "./worker-client.js";
import { extractFirstPodFromZipBytes } from "./zip-utils.js";
import { readFile, removePath, resetSessionFolder } from "./shared/opfs.js";
import { initModal } from "./ui/modal.js";
import { dispatch } from "./preview/preview-dispatcher.js";
import { formatFileSize, getRawDescription } from "./file-type-info.js";
import { MenuBar, showContextMenu } from "./ui/menu.js";
import { EntryList } from "./ui/entry-list.js";
import { SearchPanel } from "./ui/search-panel.js";
import { alertDialog, chooseDialog, confirmDialog, openDialog, promptDialog, reportDialog } from "./ui/dialogs.js";
import {
  downloadBlob, droppedFiles, ensureWritable, forgetRecent, hasDirectoryAccess, hasFileSystemAccess, listRecent,
  pickArchive, pickFiles, pickFolderFiles, pickWritableDirectory, rememberRecent, writeIntoDirectory, writeToHandle,
} from "./app/disk.js";
import { pickSaveHandle } from "./app/save-target.js";
import * as tools from "./app/tools.js";
import { importImages } from "./app/image-import.js";
import { PodDocument, documentFromArchive } from "./model/pod-document.js";
import { History } from "./model/history.js";
import { EditRejected, validateDocument } from "./model/validate.js";
import { allFolderKeys, buildRows, cycleSort } from "./model/browser.js";
import { addEntries, createFolder, moveEntries, removeEntries, renameEntry, renameFolder, replaceEntry, setComment, setDisabled } from "./model/edits.js";
import { disabledName, enabledName } from "./model/disable.js";
import { parseResponseList, resolveCandidates } from "./model/response-list.js";
import { entryKey, joinEntry, parentPath, toEntryName } from "./model/paths.js";
import { encodeWindows1252 } from "./vendor/openphotex/index.js";

const SESSION_ID = "jspod";
const SESSION = `sessions/${SESSION_ID}`;
const FORMAT_LABEL = { pod1: "POD1", pod2: "POD2", epd: "EPD" };

let archiveCounter = 0;
const nextArchivePath = () => `${SESSION}/archive-${++archiveCounter}.pod`;
const newBlobPath = () => `${SESSION}/blobs/${crypto.randomUUID()}`;

export class PodApp {
  constructor() {
    this.workerClient = null;
    /** @type {PodDocument|null} */
    this.doc = null;
    this.history = new History();
    this.podIndex = null;       // the archive as last read from disk, for Validate and the reports
    this.archivePath = null;    // where that archive is staged in OPFS
    this.handle = null;         // FileSystemFileHandle for Save in place (Chromium)
    this.view = { collapsed: new Set(), filter: "", sort: null };
    this.bytesCache = new WeakMap();
    this.previewEntry = null;
    this.busy = false;
    this.settings = loadSettings();
  }

  mount(doc) {
    this.doc_ = doc;
    this.workerClient = new WorkerClient(new URL("./worker/pod-worker.js", import.meta.url));
    const $ = (id) => doc.getElementById(id);
    this.el = {
      menubar: $("menubar"), status: $("status-bar"), info: $("archive-info"), fileName: $("archive-name"),
      formatBadge: $("archive-format"), outputFormat: $("output-format"), comment: $("comment-input"),
      commentCount: $("comment-count"), filter: $("search-input"), list: $("entry-list"),
      previewContent: $("preview-content"), previewMeta: $("preview-meta"), footer: $("footer-status"),
      loading: $("loading-overlay"), loadingMsg: $("loading-msg"), modal: $("main-dialog"),
      toolbar: $("toolbar"), layout: $("main-layout"), splitter: $("splitter"),
    };
    initModal(this.el.modal);
    this.menuBar = new MenuBar(this.el.menubar, this.menus());
    this.list = new EntryList(this.el.list, {
      onFocus: (row) => this.preview(row.entry),
      onActivate: (row) => this.preview(row.entry),
      onToggle: (key) => this.toggleFolder(key),
      onSort: (column) => { this.view.sort = cycleSort(this.view.sort, column); this.renderList(); },
      onContextMenu: (e, row) => this.contextMenu(e, row),
      onMoveSelection: (folder) => this.moveSelectionTo(folder),
      onDropFiles: (dt, folder) => this.dropFiles(dt, folder),
      onSelectionChange: () => this.renderFooter(),
      onKey: (e) => this.listKey(e),
    });
    this.search = new SearchPanel({
      entries: () => this.doc?.entries ?? [],
      reveal: (entry) => this.reveal(entry),
    });
    this.wireToolbar();
    this.el.filter.addEventListener("input", () => { this.view.filter = this.el.filter.value; this.renderList(); });
    this.el.comment.addEventListener("input", () => this.renderCommentCount());
    this.el.comment.addEventListener("change", () => this.commitComment());
    this.el.comment.addEventListener("keydown", (e) => { if (e.key === "Enter") this.el.comment.blur(); });
    this.el.outputFormat.addEventListener("change", () => this.changeOutputFormat(this.el.outputFormat.value));
    doc.addEventListener("keydown", (e) => this.globalKey(e));
    this.wireWindowDrop(doc);
    this.wireSplitter();
    window.addEventListener("beforeunload", (e) => {
      if (this.doc?.dirty) { e.preventDefault(); e.returnValue = ""; }
    });
    this.render();
    void this.autoloadFromPageQuery();
  }

  // ─── Menus ──────────────────────────────────────────────────────────────────

  menus() {
    const has = () => !!this.doc;
    const sel = () => this.list?.getSelection() ?? { entries: [], folders: [] };
    const any = () => has() && (sel().entries.length + sel().folders.length) > 0;
    const one = () => has() && (sel().entries.length + sel().folders.length) === 1;
    const oneFile = () => has() && sel().entries.length === 1 && sel().folders.length === 0;
    const mod = isMac() ? "⌘" : "Ctrl+";
    return [
      { label: "File", items: () => [
        { label: "New Archive", action: () => this.newArchive() },
        { label: "Open...", shortcut: `${mod}O`, action: () => this.openArchive() },
        { label: "Open from URL...", action: () => this.openUrlPrompt() },
        { label: "Open Response List...", action: () => this.openResponseList() },
        { label: "Open Recent", enabled: () => hasFileSystemAccess, submenu: () => this.recentItems() },
        "-",
        { label: "Save", shortcut: `${mod}S`, enabled: has, action: () => this.save() },
        { label: "Save As...", shortcut: `${mod}Shift+S`, enabled: has, action: () => this.saveAs() },
        "-",
        { label: "Close", enabled: has, action: () => this.closeArchive() },
        { label: "Clear Temporary Storage", action: () => this.clearSession() },
      ] },
      { label: "Edit", items: () => [
        { label: this.history.undoLabel ? `Undo ${this.history.undoLabel}` : "Undo", shortcut: `${mod}Z`, enabled: () => this.history.canUndo, action: () => this.undo() },
        { label: this.history.redoLabel ? `Redo ${this.history.redoLabel}` : "Redo", shortcut: isMac() ? "⌘Shift+Z" : "Ctrl+Y", enabled: () => this.history.canRedo, action: () => this.redo() },
        "-",
        { label: "Select All", shortcut: `${mod}A`, enabled: has, action: () => this.list.selectAll() },
        { label: "Find...", shortcut: `${mod}F`, enabled: has, action: () => this.search.open() },
        "-",
        { label: "Edit Comment", enabled: has, action: () => this.el.comment.focus() },
      ] },
      { label: "Entry", items: () => [
        { label: "Add Files...", enabled: has, action: () => this.addFilesPicker() },
        { label: "Add Folder...", enabled: has, action: () => this.addFolderPicker() },
        { label: "Create Folder...", enabled: has, action: () => this.createFolderPrompt() },
        { label: "Import Image as RAW...", enabled: has, action: () => this.importImage() },
        "-",
        { label: "Replace with File...", enabled: oneFile, action: () => this.replaceSelected() },
        { label: "Rename...", shortcut: "F2", enabled: one, action: () => this.renameSelected() },
        { label: "Move To Folder...", enabled: any, action: () => this.moveSelectedPrompt() },
        { label: "Remove", shortcut: "Del", enabled: any, action: () => this.removeSelected() },
        "-",
        { label: "Disable in Game", enabled: () => sel().entries.some((e) => disabledName(e.name)), action: () => this.disableSelected(true) },
        { label: "Enable in Game", enabled: () => sel().entries.some((e) => enabledName(e.name)), action: () => this.disableSelected(false) },
        "-",
        { label: "Extract Selected...", enabled: any, action: () => this.extract(false) },
        { label: "Extract All...", enabled: () => has() && this.doc.entries.length > 0, action: () => this.extract(true) },
        { label: "Download All as ZIP", enabled: () => has() && this.doc.entries.length > 0, action: () => this.downloadZip(this.doc.entries) },
      ] },
      { label: "Tools", items: () => [
        { label: "Validate", enabled: has, action: () => tools.validate(this) },
        "-",
        { label: "View POD2 Audit History", enabled: has, action: () => tools.auditHistory(this) },
        { label: "Record POD2 Audit History", checked: () => this.settings.auditEnabled, action: () => this.toggleAudit() },
        { label: "Set Audit Author...", action: () => this.setAuditAuthor() },
        "-",
        { label: "Save .inf Report...", enabled: has, action: () => tools.saveInfo(this) },
        { label: "Save .lst List...", enabled: has, action: () => tools.saveList(this) },
        { label: "Mount in pod.ini...", enabled: has, action: () => tools.mountInPodIni(this) },
      ] },
      { label: "Help", items: () => [
        { label: "Keyboard Shortcuts", action: () => this.showShortcuts() },
        { label: "Browser Support", action: () => this.showBrowserSupport() },
        { label: "About JSPod", action: () => this.showAbout() },
      ] },
    ];
  }

  wireToolbar() {
    const actions = {
      new: () => this.newArchive(), open: () => this.openArchive(), save: () => this.save(),
      undo: () => this.undo(), redo: () => this.redo(), add: () => this.addFilesPicker(),
      addFolder: () => this.addFolderPicker(), newFolder: () => this.createFolderPrompt(),
      remove: () => this.removeSelected(), extract: () => this.extract(false),
      expand: () => { this.view.collapsed.clear(); this.renderList(); },
      collapse: () => { if (this.doc) { this.view.collapsed = allFolderKeys(this.doc); this.renderList(); } },
      find: () => this.search.open(),
    };
    this.el.toolbar.addEventListener("click", (e) => {
      const button = e.target.closest("button[data-action]");
      if (button && !button.disabled) actions[button.dataset.action]?.();
    });
    // Recent files need an async lookup, so the File menu's submenu is filled when it opens.
    this.recentCache = [];
    const refreshRecent = async () => { this.recentCache = await listRecent(); };
    void refreshRecent();
    this.recentItems = () => {
      void refreshRecent();
      if (!this.recentCache.length) return [{ label: "(none)", enabled: () => false }];
      return this.recentCache.map((r) => ({ label: r.name, action: () => this.openRecent(r) }));
    };
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  render() {
    this.renderChrome();
    this.renderList();
    if (!this.doc) {
      this.el.previewMeta.replaceChildren();
      this.el.previewContent.innerHTML = '<div class="preview-placeholder"><p>Open a POD, EPD or ZIP, drop one here, or start a new archive.</p></div>';
    }
  }

  renderChrome() {
    const d = this.doc;
    const title = d ? `${d.dirty ? "• " : ""}${d.sourceName} - JSPod` : "JSPod - TRI POD Archive Editor";
    this.doc_.title = title;
    this.el.fileName.textContent = d ? d.sourceName + (d.dirty ? " •" : "") : "No archive open";
    this.el.formatBadge.textContent = d ? (d.format ? `Read as ${FORMAT_LABEL[d.format]}` : "New archive") : "";
    this.el.formatBadge.hidden = !d;
    this.el.outputFormat.disabled = !d;
    this.el.outputFormat.value = d?.outputFormat ?? "pod1";
    this.el.comment.disabled = !d;
    if (document.activeElement !== this.el.comment) this.el.comment.value = d?.comment ?? "";
    this.renderCommentCount();
    for (const button of this.el.toolbar.querySelectorAll("button[data-action]")) {
      const action = button.dataset.action;
      const needsDoc = !["new", "open"].includes(action);
      let enabled = !needsDoc || !!d;
      if (action === "undo") enabled = this.history.canUndo;
      if (action === "redo") enabled = this.history.canRedo;
      if (["remove", "extract"].includes(action) && d) {
        const s = this.list?.getSelection();
        enabled = !!s && s.entries.length + s.folders.length > 0;
      }
      button.disabled = !enabled || this.busy;
    }
    this.renderFooter();
  }

  renderCommentCount() {
    const encoded = encodeWindows1252(this.el.comment.value);
    const bytes = typeof encoded === "number" ? null : encoded.length;
    this.el.commentCount.textContent = bytes === null ? "invalid character" : `${bytes}/79`;
    this.el.commentCount.classList.toggle("over", bytes === null || bytes > 79);
  }

  renderList() {
    const rows = this.doc ? buildRows(this.doc, this.view) : [];
    this.list.setRows(rows, this.view.sort);
    this.renderFooter();
  }

  renderFooter() {
    const d = this.doc;
    if (!d) { this.el.footer.textContent = ""; this.renderToolbarSelection(); return; }
    const s = this.list.getSelection();
    // A selected folder counts every entry under it, as in KPod.
    const selected = s.folders.length ? this.selectedEntriesDeep().length : s.entries.length;
    const parts = [
      `${d.entries.length.toLocaleString()} files`,
      `${formatFileSize(d.projectedSize())} as ${FORMAT_LABEL[d.outputFormat]}`,
    ];
    if (selected) parts.push(`${selected} selected`);
    if (d.outputFormat === "pod2") parts.push(`${d.outputAuditCount()} audit records`);
    parts.push(d.dirty ? "unsaved changes" : "saved");
    this.el.footer.textContent = parts.join("  ·  ");
    this.renderToolbarSelection();
  }

  renderToolbarSelection() {
    const s = this.list?.getSelection();
    const hasSel = !!this.doc && !!s && s.entries.length + s.folders.length > 0;
    for (const action of ["remove", "extract"]) {
      const b = this.el.toolbar.querySelector(`button[data-action="${action}"]`);
      if (b) b.disabled = !hasSel || this.busy;
    }
  }

  setStatus(message) {
    this.el.status.textContent = message;
  }

  async withBusy(message, work) {
    if (this.busy) return undefined;
    this.busy = true;
    this.renderChrome();
    this.setStatus(message);
    this.el.loading.hidden = false;
    this.el.loadingMsg.textContent = message;
    try {
      return await work((m) => { this.el.loadingMsg.textContent = m; });
    } catch (error) {
      console.error(error);
      this.setStatus(`Error: ${error.message}`);
      await alertDialog("Something went wrong", error.message);
      return undefined;
    } finally {
      this.busy = false;
      this.el.loading.hidden = true;
      this.renderChrome();
    }
  }

  // ─── Document lifecycle ─────────────────────────────────────────────────────

  setDocument(doc, { archivePath = null, podIndex = null, handle = null, keepView = false } = {}) {
    doc.auditEnabled = this.settings.auditEnabled;
    doc.auditAuthor = this.settings.auditAuthor;
    this.doc = doc;
    this.archivePath = archivePath;
    this.podIndex = podIndex;
    this.handle = handle;
    this.history.clear();
    this.bytesCache = new WeakMap();
    if (!keepView) {
      this.view = { collapsed: allFolderKeys(doc), filter: "", sort: null };
      this.el.filter.value = "";
      this.previewEntry = null;
      this.el.previewMeta.replaceChildren();
      this.el.previewContent.innerHTML = '<div class="preview-placeholder"><p>Select a file to preview it here.</p></div>';
    }
    this.render();
  }

  async confirmDiscard() {
    if (!this.doc?.dirty) return true;
    return confirmDialog("Unsaved changes", `${this.doc.sourceName} has unsaved changes. Discard them?`, { okLabel: "Discard", danger: true });
  }

  async newArchive() {
    if (!(await this.confirmDiscard())) return;
    await resetSessionFolder(SESSION_ID).catch(() => {});
    this.setDocument(new PodDocument({ sourceName: "untitled.pod" }));
    this.setStatus("New archive. Add files, then save.");
  }

  async closeArchive() {
    if (!(await this.confirmDiscard())) return;
    await resetSessionFolder(SESSION_ID).catch(() => {});
    this.doc = null;
    this.podIndex = null;
    this.archivePath = null;
    this.handle = null;
    this.history.clear();
    this.render();
    this.setStatus("Closed.");
  }

  async clearSession() {
    if (!(await this.confirmDiscard())) return;
    await this.closeArchiveNow();
    this.setStatus("Temporary storage cleared.");
  }

  async closeArchiveNow() {
    await resetSessionFolder(SESSION_ID).catch(() => {});
    this.doc = null;
    this.podIndex = null;
    this.archivePath = null;
    this.handle = null;
    this.history.clear();
    this.render();
  }

  async openArchive() {
    if (!(await this.confirmDiscard())) return;
    const picked = await pickArchive();
    if (picked) await this.openFile(picked.file, picked.handle);
  }

  async openRecent(record) {
    if (!(await this.confirmDiscard())) return;
    try {
      if (!(await ensureWritable(record.handle))) {
        await alertDialog("Permission needed", `JSPod needs permission to open ${record.name}.`);
        return;
      }
      await this.openFile(await record.handle.getFile(), record.handle);
    } catch (error) {
      await forgetRecent(record.name);
      await alertDialog("Cannot open", `${record.name} could not be opened (${error.message}). It was removed from Recent.`);
    }
  }

  async openUrlPrompt() {
    if (!(await this.confirmDiscard())) return;
    const url = await promptDialog("Open from URL", "POD, EPD or ZIP address:", "", {
      validate: (v) => (v.trim() ? null : "Enter an address."),
      hint: "The server must allow cross-origin downloads (CORS).",
    });
    if (url) await this.openUrl(url.trim());
  }

  async openUrl(raw) {
    let url;
    try { url = new URL(raw, document.baseURI).toString(); } catch { url = raw; }
    await this.withBusy(`Fetching ${url}...`, async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
      const blob = await response.blob();
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "archive.pod");
      await this.openFileNow(new File([blob], name), null);
    });
  }

  async openFile(file, handle) {
    await this.withBusy(`Opening ${file.name}...`, () => this.openFileNow(file, handle));
  }

  async openFileNow(file, handle) {
    const upper = file.name.toUpperCase();
    let data = file;
    let name = file.name;
    if (upper.endsWith(".ZIP")) {
      const result = await extractFirstPodFromZipBytes(new Uint8Array(await file.arrayBuffer()), file.name);
      data = new Blob([result.podBytes]);
      name = result.podEntryName.split("/").pop();
      handle = null;
    } else if (!upper.endsWith(".POD") && !upper.endsWith(".EPD")) {
      throw new Error("Only .pod, .epd and .zip (containing a .pod) files can be opened.");
    }
    await resetSessionFolder(SESSION_ID);
    const path = nextArchivePath();
    await this.workerClient.call("stageBlob", { path, data });
    const { podIndex, rawComment } = await this.indexArchive(path);
    const doc = documentFromArchive(podIndex, { path, sourceName: name, rawComment });
    const inPlace = handle && podIndex.format !== "epd" ? handle : null;
    this.setDocument(doc, { archivePath: path, podIndex, handle: inPlace });
    if (inPlace) await rememberRecent(inPlace);
    this.setStatus(`Opened ${name} · ${FORMAT_LABEL[doc.format]} · ${doc.entries.length} entries`);
  }

  async indexArchive(path) {
    const index = await this.workerClient.call("indexPod", { opfsPodPath: path });
    const podIndex = { ...index, format: String(index.format).toLowerCase() };
    const { bytes } = await this.workerClient.call("readRawComment", { opfsPodPath: path, format: podIndex.format });
    return { podIndex, rawComment: bytes };
  }

  async openResponseList() {
    if (!(await this.confirmDiscard())) return;
    const files = await pickFolderFiles();
    if (!files) return;
    const lists = files.filter((f) => /\.(lst|rsp)$/i.test(f.path));
    if (!lists.length) {
      await alertDialog("No response list", "The folder has no .lst or .rsp file. Pick the folder that holds the list (or its parent).");
      return;
    }
    const chosen = lists.length === 1 ? lists[0] : await chooseDialog("Open Response List", "Which list?", lists.map((l) => ({ label: l.path, value: l })));
    if (!chosen) return;
    const list = parseResponseList(await chosen.file.text());
    const byPath = new Map(files.map((f) => [f.path.toLowerCase(), f.file]));
    const listFolder = chosen.path.includes("/") ? chosen.path.slice(0, chosen.path.lastIndexOf("/")) : "";
    const missing = [];
    const found = [];
    for (const item of list.items) {
      const file = resolveCandidates(listFolder, item.file).map((p) => byPath.get(p.toLowerCase())).find(Boolean);
      if (file) found.push({ file, name: item.entryName });
      else missing.push(item.file);
    }
    if (missing.length) {
      await reportDialog("Response list", { errors: missing.map((m) => `Manifest entry not found: ${m}`) });
      return;
    }
    await this.withBusy(`Building ${list.podFilename}...`, async (progress) => {
      await resetSessionFolder(SESSION_ID);
      const doc = new PodDocument({ sourceName: list.podFilename, comment: list.volumeName });
      const items = await this.stageFiles(found.map((f) => ({ file: f.file, name: f.name })), progress);
      this.setDocument(doc);
      // One step, then forget it: the built archive is the starting point, unsaved.
      this.history.run(doc, "Build", (d) => addEntries(d, items, { replace: () => true }));
      this.history.clear();
      this.render();
      this.setStatus(`Built ${list.podFilename} from ${chosen.path}: ${items.length} entries. Save to write it.`);
    });
  }

  // ─── Saving ─────────────────────────────────────────────────────────────────

  async save() {
    const d = this.doc;
    if (!d) return;
    if (!hasFileSystemAccess) {
      if (!d.format) return this.saveAs();
      return this.saveTo({ handle: null, name: d.sourceName });
    }
    if (!this.handle) return this.saveAs();
    if (!(await this.checkSavable())) return;
    const ok = await confirmDialog("Save", `Write ${this.handle.name} as ${FORMAT_LABEL[d.outputFormat]} (${d.entries.length} entries, ${formatFileSize(d.projectedSize())})?`, { okLabel: "Save" });
    if (!ok) return;
    if (!(await ensureWritable(this.handle))) {
      await alertDialog("Permission needed", "JSPod was not allowed to write the file. Use Save As instead.");
      return;
    }
    await this.saveTo({ handle: this.handle, name: this.handle.name });
  }

  async saveAs() {
    const d = this.doc;
    if (!d) return;
    const format = await chooseDialog("Save As", "Archive format:", [
      { label: "POD1", value: "pod1", description: "Monster Truck Madness 1 and 2, CART Precision Racing, Terminal Velocity, Fury3, Hellbender. Names up to 31 bytes." },
      { label: "POD2", value: "pod2", description: "4x4 Evolution 1 and 2. CRC checksums, timestamps and an audit trail." },
    ], { initial: d.outputFormat });
    if (!format) return;
    if (d.format === "pod2" && format === "pod1") {
      const ok = await confirmDialog("Convert to POD1", "POD1 has no timestamps, checksums or audit history. They will not be written. Continue?", { okLabel: "Convert" });
      if (!ok) return;
    }
    const previous = d.outputFormat;
    d.outputFormat = format;
    if (!(await this.checkSavable())) { d.outputFormat = previous; this.renderChrome(); return; }
    const suggested = /\.(pod)$/i.test(d.sourceName) ? d.sourceName : d.sourceName.replace(/\.[^.]*$/, "") + ".pod";
    const target = await pickSaveHandle(suggested);
    if (target === null) { d.outputFormat = previous; this.renderChrome(); return; }
    if (target === undefined) {
      const name = await promptDialog("Save As", "File name:", suggested, { validate: (v) => (v.trim() ? null : "Enter a file name.") });
      if (!name) { d.outputFormat = previous; this.renderChrome(); return; }
      const typed = name.trim();
      await this.saveTo({ handle: null, name: /\.[^.\\/]+$/.test(typed) ? typed : `${typed}.pod` });
      return;
    }
    await this.saveTo({ handle: target, name: target.name });
  }

  async checkSavable() {
    const report = validateDocument(this.doc, { forSave: true });
    if (report.errors.length) {
      await reportDialog("Cannot save", report);
      return false;
    }
    return true;
  }

  async saveTo({ handle, name }) {
    const d = this.doc;
    await this.withBusy(`Saving ${name}...`, async (progress) => {
      const outPath = nextArchivePath();
      const raw = d.commentForWrite();
      await this.workerClient.call("writeArchive", {
        outPath,
        format: d.outputFormat,
        comment: d.comment,
        rawComment: raw instanceof Uint8Array ? raw : null,
        entries: d.entries.map((e) => ({ name: e.name, length: e.length, timestamp: e.timestamp, paletteName: e.paletteName, source: { ...e.source } })),
        auditTrail: d.outputFormat === "pod2" ? d.auditTrail : null,
        auditAdded: d.outputFormat === "pod2" ? d.auditAdded : [],
        now: Math.floor(Date.now() / 1000),
      }, { onProgress: progress });
      progress("Writing to disk...");
      const file = await readFile(outPath);
      if (handle) await writeToHandle(handle, file);
      else downloadBlob(file, name);

      progress("Reopening...");
      const { podIndex, rawComment } = await this.indexArchive(outPath);
      const selectedNames = new Set(this.list.getSelection().entries.map((e) => e.normalizedName));
      const previewName = this.previewEntry?.normalizedName;
      const oldPath = this.archivePath;
      const next = documentFromArchive(podIndex, { path: outPath, sourceName: name, rawComment });
      next.outputFormat = d.outputFormat;
      next.folders = new Set(d.folders);
      this.setDocument(next, { archivePath: outPath, podIndex, handle: handle ?? null, keepView: true });
      if (handle) await rememberRecent(handle);
      this.list.selectEntries(next.entries.filter((e) => selectedNames.has(e.normalizedName)).map((e) => e.id), { focus: false });
      if (previewName) this.previewEntry = next.entries.find((e) => e.normalizedName === previewName) ?? null;
      // The old archive and the staged data are no longer referenced (undo history was reset).
      if (oldPath && oldPath !== outPath) await removePath(oldPath);
      await removePath(`${SESSION}/blobs`);
      this.setStatus(`Saved ${name} · ${FORMAT_LABEL[next.format]} · ${next.entries.length} entries · ${formatFileSize(podIndex.byteLength)}${handle ? "" : " (downloaded)"}`);
    });
  }

  // ─── Editing ────────────────────────────────────────────────────────────────

  /** Runs one undoable edit; shows why when it is refused. Returns the edit's result or false. */
  async edit(label, fn) {
    if (!this.doc) return false;
    try {
      const result = this.history.run(this.doc, label, fn);
      if (result === false) return false;
      this.renderList();
      this.renderChrome();
      return result;
    } catch (error) {
      if (error instanceof EditRejected) await reportDialog(`Cannot ${label.toLowerCase()}`, { errors: error.errors });
      else await alertDialog(`Cannot ${label.toLowerCase()}`, error.message);
      return false;
    }
  }

  undo() {
    if (!this.doc) return;
    const label = this.history.undo(this.doc);
    if (label) { this.render(); this.setStatus(`Undid ${label}.`); }
  }

  redo() {
    if (!this.doc) return;
    const label = this.history.redo(this.doc);
    if (label) { this.render(); this.setStatus(`Redid ${label}.`); }
  }

  /** The folder new entries go into: the selected folder, if exactly one folder is selected. */
  targetFolder() {
    const s = this.list.getSelection();
    return s.folders.length === 1 && s.entries.length === 0 ? s.folders[0] : "";
  }

  /** Copies files into OPFS and returns addEntries items. */
  async stageFiles(files, progress = () => {}) {
    const items = [];
    for (let i = 0; i < files.length; i++) {
      const { file, name } = files[i];
      if (i % 8 === 0) progress(`Copying ${i + 1} of ${files.length}...`);
      const path = newBlobPath();
      const { length } = await this.workerClient.call("stageBlob", { path, data: file });
      items.push({ name, length, timestamp: Math.floor((file.lastModified || Date.now()) / 1000), source: { kind: "blob", path } });
    }
    return items;
  }

  async stageBytes(bytes) {
    const path = newBlobPath();
    await this.workerClient.call("stageBlob", { path, data: bytes });
    return { kind: "blob", path };
  }

  /** Adds files ({file, path} with "/" separators) under `folder`, asking about name clashes. */
  async addFiles(files, folder) {
    if (!this.doc) await this.newArchiveSilently();
    const named = files.map((f) => ({ file: f.file, name: joinEntry(folder, toEntryName(f.path)) }));
    const clashes = named.filter((f) => this.doc.indexOfKey(f.name) >= 0);
    let replace = false;
    if (clashes.length) {
      const answer = await openDialog({
        title: "Entries already exist",
        body: clashes.length === 1 ? `${clashes[0].name} already exists. Replace it?` : `${clashes.length} entries already exist (${clashes.slice(0, 3).map((c) => c.name).join(", ")}${clashes.length > 3 ? ", ..." : ""}). Replace them?`,
        buttons: [{ label: "Cancel", value: null }, { label: "Skip", value: "skip" }, { label: "Replace", value: "replace", primary: true }],
      });
      if (!answer) return;
      replace = answer === "replace";
    }
    const items = await this.withBusy("Adding files...", (progress) => this.stageFiles(named, progress));
    if (!items) return;
    const result = await this.edit(items.length === 1 ? "Add File" : "Add Files", (d) => addEntries(d, items, { replace: () => replace }));
    if (result) {
      for (const f of ancestorsOf(result.entries)) this.view.collapsed.delete(f);
      this.renderList();
      this.list.selectEntries(result.entries.map((e) => e.id));
      this.setStatus(`${result.added} added, ${result.replaced} replaced${result.skipped ? `, ${result.skipped} skipped` : ""}.`);
    }
  }

  async newArchiveSilently() {
    await resetSessionFolder(SESSION_ID).catch(() => {});
    this.setDocument(new PodDocument({ sourceName: "untitled.pod" }));
  }

  async addFilesPicker() {
    const files = await pickFiles();
    if (files.length) await this.addFiles(files.map((file) => ({ file, path: file.name })), this.targetFolder());
  }

  async addFolderPicker() {
    const files = await pickFolderFiles();
    if (files?.length) await this.addFiles(files, this.targetFolder());
  }

  async dropFiles(dataTransfer, folder) {
    const files = await droppedFiles(dataTransfer);
    if (!files.length) return;
    if (!this.doc && files.length === 1 && /\.(pod|epd|zip)$/i.test(files[0].file.name)) {
      await this.openFile(files[0].file, null);
      return;
    }
    await this.addFiles(files, folder);
  }

  wireWindowDrop(doc) {
    doc.addEventListener("dragover", (e) => {
      if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
    });
    doc.addEventListener("drop", async (e) => {
      if (![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault();
      const files = await droppedFiles(e.dataTransfer);
      if (files.length === 1 && /\.(pod|epd|zip)$/i.test(files[0].file.name) && (await this.confirmDiscard())) {
        await this.openFile(files[0].file, null);
      } else if (files.length) {
        await this.addFiles(files, "");
      }
    });
  }

  async createFolderPrompt() {
    if (!this.doc) return;
    const parent = this.targetFolder();
    const name = await promptDialog("Create Folder", parent ? `New folder in ${parent}:` : "Folder name:", "");
    if (!name) return;
    const path = await this.edit("Create Folder", (d) => createFolder(d, parent, name));
    if (path) {
      for (const f of [parent, ...ancestorsOfPath(path)]) if (f) this.view.collapsed.delete(entryKey(f));
      this.renderList();
    }
  }

  async replaceSelected() {
    const [entry] = this.list.getSelection().entries;
    if (!entry) return;
    const [file] = await pickFiles({ multiple: false });
    if (!file) return;
    const [item] = await this.withBusy("Copying...", (p) => this.stageFiles([{ file, name: entry.name }], p)) ?? [];
    if (!item) return;
    const replaced = await this.edit("Replace", (d) => replaceEntry(d, entry.id, item));
    if (replaced) {
      this.list.selectEntries([replaced.id]);
      this.preview(replaced);
      this.setStatus(`${entry.name} replaced (${replaced.length.toLocaleString()} bytes).`);
    }
  }

  async renameSelected() {
    const s = this.list.getSelection();
    if (s.entries.length + s.folders.length !== 1) return;
    if (s.folders.length) {
      const folder = s.folders[0];
      const label = folder.slice(folder.lastIndexOf("\\") + 1);
      const name = await promptDialog("Rename Folder", "New name:", label);
      if (!name || name === label) return;
      if (await this.edit("Rename Folder", (d) => renameFolder(d, folder, name))) this.setStatus(`Renamed ${folder}.`);
      return;
    }
    const entry = s.entries[0];
    const name = await promptDialog("Rename", "New name:", entry.title);
    if (!name || name === entry.title) return;
    const renamed = await this.edit("Rename", (d) => renameEntry(d, entry.id, name));
    if (renamed) {
      this.list.selectEntries([renamed.id]);
      if (this.previewEntry?.id === entry.id) this.previewEntry = renamed;
    }
  }

  async moveSelectedPrompt() {
    const s = this.list.getSelection();
    if (!s.entries.length && !s.folders.length) return;
    const folders = new Map([["", "(archive root)"]]);
    for (const row of buildRows(this.doc, { collapsed: new Set() })) if (row.kind === "folder") folders.set(row.path, row.path);
    const select = document.createElement("select");
    select.className = "modal-select";
    select.size = Math.min(14, folders.size);
    for (const [path, label] of folders) {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = "";
    const result = await openDialog({
      title: "Move To Folder",
      body: select,
      buttons: [{ label: "Cancel", value: null }, { label: "Move", value: "ok", primary: true }],
    });
    if (result === "ok") await this.moveSelectionTo(select.value);
  }

  async moveSelectionTo(folder) {
    const s = this.list.getSelection();
    if (!s.entries.length && !s.folders.length) return;
    const ids = s.entries.map((e) => e.id);
    const names = s.entries.map((e) => e.title);
    const moved = await this.edit("Move", (d) => moveEntries(d, ids, s.folders, folder));
    if (moved) {
      if (folder) this.view.collapsed.delete(entryKey(folder));
      for (const f of ancestorsOfPath(folder)) this.view.collapsed.delete(entryKey(f));
      this.renderList();
      const dest = entryKey(folder);
      const hits = this.doc.entries.filter((e) => names.includes(e.title) && entryKey(parentPath(e.name)) === dest).map((e) => e.id);
      if (hits.length) this.list.selectEntries(hits);
      this.setStatus(`Moved ${moved} ${moved === 1 ? "entry" : "entries"} to ${folder || "the root"}.`);
    }
  }

  async removeSelected() {
    const s = this.list.getSelection();
    if (!s.entries.length && !s.folders.length) return;
    const removed = await this.edit("Remove", (d) => removeEntries(d, s.entries.map((e) => e.id), s.folders));
    if (removed !== false) {
      if (this.previewEntry && !this.doc.entryById(this.previewEntry.id)) this.clearPreview();
      this.setStatus(`${removed} ${removed === 1 ? "entry" : "entries"} removed. ${isMac() ? "⌘" : "Ctrl+"}Z undoes it.`);
    }
  }

  async disableSelected(disable) {
    const s = this.list.getSelection();
    const titles = new Set(s.entries.map((e) => e.normalizedName));
    const changed = await this.edit(disable ? "Disable" : "Enable", (d) => setDisabled(d, s.entries.map((e) => e.id), disable));
    if (changed) {
      const renamed = this.doc.entries.filter((e) => titles.has(entryKey(disable ? enabledName(e.name) ?? "" : disabledName(e.name) ?? "")));
      this.list.selectEntries(renamed.map((e) => e.id), { focus: false });
      this.setStatus(`${changed} ${disable ? "disabled" : "enabled"}. Changing a track pod can make multiplayer report "Different Version".`);
    }
  }

  async commitComment() {
    if (!this.doc) return;
    const value = this.el.comment.value;
    const ok = await this.edit("Edit Comment", (d) => setComment(d, value));
    if (ok === false) this.el.comment.value = this.doc.comment;
  }

  async changeOutputFormat(format) {
    const d = this.doc;
    if (!d || d.outputFormat === format) return;
    if (d.format === "pod2" && format === "pod1") {
      const ok = await confirmDialog("Save as POD1", "POD1 has no timestamps, checksums or audit history. They will not be written. Continue?", { okLabel: "Use POD1" });
      if (!ok) { this.renderChrome(); return; }
    }
    const previous = d.outputFormat;
    d.outputFormat = format;
    const report = validateDocument(d);
    if (report.errors.length) {
      d.outputFormat = previous;
      await reportDialog(`Cannot save as ${FORMAT_LABEL[format]}`, report);
    }
    this.renderChrome();
  }

  /** Writes edited bytes back into an entry (text editor, image edits). */
  async replaceEntryBytes(entry, bytes, label = "Edit Text") {
    const source = await this.stageBytes(bytes);
    const replaced = await this.edit(label, (d) => replaceEntry(d, entry.id, { length: bytes.length, source, timestamp: Math.floor(Date.now() / 1000) }));
    if (replaced) {
      this.list.selectEntries([replaced.id], { focus: false });
      await this.preview(replaced);
      this.setStatus(`${replaced.name} updated. ${isMac() ? "⌘" : "Ctrl+"}Z undoes it.`);
    }
    return replaced;
  }

  async importImage() {
    await importImages(this);
  }

  // ─── Extract ────────────────────────────────────────────────────────────────

  selectedEntriesDeep() {
    const s = this.list.getSelection();
    const ids = new Set(s.entries.map((e) => e.id));
    const keys = s.folders.map((f) => entryKey(f));
    return this.doc.entries.filter((e) => ids.has(e.id) || keys.some((k) => e.normalizedName.startsWith(k + "/")));
  }

  async extract(all) {
    if (!this.doc) return;
    const entries = all ? this.doc.entries : this.selectedEntriesDeep();
    if (!entries.length) return;
    const keep = document.createElement("label");
    keep.className = "choice-row";
    keep.innerHTML = '<input type="checkbox"> <span>Keep folder structure</span>';
    const box = keep.querySelector("input");
    box.checked = this.settings.keepStructure;
    const body = document.createElement("div");
    const what = document.createElement("p");
    what.className = "modal-text";
    what.textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}. ${hasDirectoryAccess ? "You will pick the destination folder next." : "They will be downloaded" + (entries.length > 1 ? " as a ZIP." : ".")}`;
    body.append(what, keep);
    const answer = await openDialog({ title: all ? "Extract All" : "Extract Selected", body, buttons: [{ label: "Cancel", value: null }, { label: "Extract", value: "ok", primary: true }] });
    if (answer !== "ok") return;
    this.settings.keepStructure = box.checked;
    saveSettings(this.settings);
    const pathOf = (e) => (box.checked ? e.name.replace(/\\/g, "/") : e.title);
    if (hasDirectoryAccess) {
      const dir = await pickWritableDirectory();
      if (!dir) return;
      await this.withBusy("Extracting...", async (progress) => {
        for (let i = 0; i < entries.length; i++) {
          progress(`Extracting ${i + 1} of ${entries.length}...`);
          await writeIntoDirectory(dir, pathOf(entries[i]), await this.getEntryBytes(entries[i]));
        }
        this.setStatus(`Extracted ${entries.length} ${entries.length === 1 ? "entry" : "entries"} to ${dir.name}.`);
      });
    } else if (entries.length === 1) {
      downloadBlob(new Blob([await this.getEntryBytes(entries[0])]), entries[0].title);
    } else {
      await this.downloadZip(entries, pathOf);
    }
  }

  async downloadZip(entries, pathOf = (e) => e.name.replace(/\\/g, "/")) {
    await this.withBusy("Preparing ZIP...", async (progress) => {
      const { zipSync } = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
      const files = {};
      for (let i = 0; i < entries.length; i++) {
        if (i % 16 === 0) progress(`Packing ${i + 1} of ${entries.length}...`);
        files[pathOf(entries[i])] = await this.getEntryBytes(entries[i]);
      }
      downloadBlob(new Blob([zipSync(files)]), `${this.doc.sourceName.replace(/\.[^.]*$/, "")}.zip`);
    });
  }

  // ─── Preview ────────────────────────────────────────────────────────────────

  async getEntryBytes(entry) {
    const cached = this.bytesCache.get(entry);
    if (cached) return cached;
    const { bytes } = await this.workerClient.call("readEntryBytes", { opfsPodPath: this.archivePath, entry });
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.bytesCache.set(entry, data);
    return data;
  }

  /** The archive view the previews look siblings up in. */
  previewIndex() {
    return { format: this.doc.format ? FORMAT_LABEL[this.doc.format] : "POD1", comment: this.doc.comment, entries: this.doc.entries };
  }

  async preview(entry) {
    if (!entry) return;
    this.previewEntry = entry;
    this.renderMeta(entry);
    const token = (this.previewToken = (this.previewToken ?? 0) + 1);
    try {
      const bytes = await this.getEntryBytes(entry);
      if (token !== this.previewToken) return;
      await dispatch(this.el.previewContent, bytes, {
        entry,
        podIndex: this.previewIndex(),
        workerClient: this.workerClient,
        opfsPodPath: this.archivePath,
        selectEntry: (e) => this.reveal(e),
        editText: (e, newBytes) => this.replaceEntryBytes(e, newBytes),
      });
    } catch (error) {
      this.el.previewContent.innerHTML = "";
      const p = document.createElement("p");
      p.className = "preview-error";
      p.textContent = `Preview error: ${error.message}`;
      this.el.previewContent.appendChild(p);
    }
  }

  clearPreview() {
    this.previewEntry = null;
    this.el.previewMeta.replaceChildren();
    this.el.previewContent.innerHTML = '<div class="preview-placeholder"><p>Select a file to preview it here.</p></div>';
  }

  renderMeta(entry) {
    const dl = document.createElement("dl");
    dl.className = "meta-list";
    const rows = [
      ["Path", entry.name],
      ["Size", `${formatFileSize(entry.length)} (${entry.length.toLocaleString()} bytes)`],
      ["Format", getRawDescription(entry.title, entry.length, entry.name)],
      ["Offset", entry.offset === null ? "not saved yet" : String(entry.offset)],
    ];
    if (entry.timestamp) rows.push(["Timestamp", new Date(entry.timestamp * 1000).toLocaleString()]);
    if (entry.paletteName) rows.push(["Palette record", entry.paletteName]);
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    }
    const actions = document.createElement("div");
    actions.className = "meta-actions";
    const download = document.createElement("button");
    download.className = "btn btn-small";
    download.textContent = "⬇ Download";
    download.addEventListener("click", async () => downloadBlob(new Blob([await this.getEntryBytes(entry)]), entry.title));
    const replace = document.createElement("button");
    replace.className = "btn btn-small";
    replace.textContent = "Replace...";
    replace.addEventListener("click", () => { this.list.selectEntries([entry.id], { focus: false }); this.replaceSelected(); });
    actions.append(download, replace);
    this.el.previewMeta.replaceChildren(dl, actions);
  }

  /** Expands the folders above an entry, selects it and previews it. */
  reveal(entry) {
    const target = this.doc?.entries.find((e) => e.id === entry.id) ?? this.doc?.entries.find((e) => e.normalizedName === entry.normalizedName);
    if (!target) return;
    for (const f of ancestorsOf([target])) this.view.collapsed.delete(f);
    this.renderList();
    this.list.selectEntries([target.id]);
    this.preview(target);
  }

  toggleFolder(key) {
    if (this.view.collapsed.has(key)) this.view.collapsed.delete(key);
    else this.view.collapsed.add(key);
    this.renderList();
  }

  // ─── Context menu and keys ──────────────────────────────────────────────────

  contextMenu(e, row) {
    if (!this.doc) return;
    const s = this.list.getSelection();
    const count = s.entries.length + s.folders.length;
    const items = [];
    if (row?.kind === "file" && count === 1) {
      items.push({ label: "Preview", action: () => this.preview(row.entry) });
      items.push({ label: "Replace with File...", action: () => this.replaceSelected() });
    }
    if (row) {
      if (count === 1) items.push({ label: "Rename...", shortcut: "F2", action: () => this.renameSelected() });
      items.push({ label: "Move To Folder...", action: () => this.moveSelectedPrompt() });
      items.push({ label: "Remove", shortcut: "Del", action: () => this.removeSelected() });
      items.push("-");
      items.push({ label: "Extract...", action: () => this.extract(false) });
      if (s.entries.some((x) => disabledName(x.name))) items.push({ label: "Disable in Game", action: () => this.disableSelected(true) });
      if (s.entries.some((x) => enabledName(x.name))) items.push({ label: "Enable in Game", action: () => this.disableSelected(false) });
      items.push("-");
    }
    items.push({ label: row?.kind === "folder" && count === 1 ? "Add Files Here..." : "Add Files...", action: () => this.addFilesPicker() });
    items.push({ label: "Add Folder...", action: () => this.addFolderPicker() });
    items.push({ label: "Create Folder...", action: () => this.createFolderPrompt() });
    showContextMenu(e.clientX, e.clientY, items);
  }

  listKey(e) {
    if (e.key === "Delete" || (isMac() && e.key === "Backspace")) { e.preventDefault(); this.removeSelected(); }
    else if (e.key === "F2") { e.preventDefault(); this.renameSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); this.list.selectAll(); }
  }

  globalKey(e) {
    const target = e.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
    if (document.querySelector("dialog[open]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") { e.preventDefault(); e.shiftKey ? this.saveAs() : this.save(); return; }
    if (mod && key === "o") { e.preventDefault(); this.openArchive(); return; }
    if (typing) return;
    if (mod && key === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && key === "y") { e.preventDefault(); this.redo(); return; }
    if (mod && key === "f") { e.preventDefault(); if (this.doc) this.search.open(); return; }
  }

  wireSplitter() {
    const splitter = this.el.splitter;
    const saved = this.settings.listWidth;
    if (saved) this.el.layout.style.setProperty("--list-w", `${saved}px`);
    splitter.addEventListener("pointerdown", (e) => {
      splitter.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const width = Math.max(260, Math.min(window.innerWidth - 300, ev.clientX - this.el.layout.getBoundingClientRect().left));
        this.el.layout.style.setProperty("--list-w", `${width}px`);
        this.settings.listWidth = width;
      };
      const up = () => {
        splitter.removeEventListener("pointermove", move);
        splitter.removeEventListener("pointerup", up);
        saveSettings(this.settings);
      };
      splitter.addEventListener("pointermove", move);
      splitter.addEventListener("pointerup", up);
    });
  }

  // ─── Settings and help ──────────────────────────────────────────────────────

  toggleAudit() {
    this.settings.auditEnabled = !this.settings.auditEnabled;
    saveSettings(this.settings);
    if (this.doc) this.doc.auditEnabled = this.settings.auditEnabled;
    this.setStatus(`POD2 audit history recording ${this.settings.auditEnabled ? "on" : "off"}.`);
  }

  async setAuditAuthor() {
    const value = await promptDialog("Set Audit Author", "Name recorded in POD2 audit history:", this.settings.auditAuthor, {
      validate: (v) => {
        const encoded = encodeWindows1252(v.trim());
        if (!v.trim()) return "Enter a name.";
        if (typeof encoded === "number") return "Use plain Latin characters only.";
        return encoded.length > 31 ? "At most 31 characters." : null;
      },
    });
    if (!value) return;
    this.settings.auditAuthor = value.trim();
    saveSettings(this.settings);
    if (this.doc) this.doc.auditAuthor = this.settings.auditAuthor;
  }

  showShortcuts() {
    const m = isMac() ? "⌘" : "Ctrl+";
    const rows = [
      [`${m}O`, "Open"], [`${m}S`, "Save"], [`${m}Shift+S`, "Save As"], [`${m}Z`, "Undo"],
      [isMac() ? "⌘Shift+Z" : "Ctrl+Y", "Redo"], [`${m}F`, "Find"], [`${m}A`, "Select all (in the list)"],
      ["Enter", "Preview a file, open or close a folder"], ["← →", "Close or open a folder"],
      ["Delete", "Remove the selection"], ["F2", "Rename"], ["Shift/Ctrl+click", "Select a range / toggle"],
      ["A, ← →", "3D viewer: step animation frames, strafe"],
    ];
    const table = document.createElement("table");
    table.className = "data-table";
    for (const [k, v] of rows) {
      const tr = table.insertRow();
      tr.insertCell().textContent = k;
      tr.insertCell().textContent = v;
    }
    return openDialog({ title: "Keyboard Shortcuts", body: table });
  }

  showBrowserSupport() {
    const fsa = hasFileSystemAccess ? "available in this browser" : "not available in this browser";
    return alertDialog("Browser Support",
      `Everything works in current Chrome, Edge, Firefox and Safari: opening, editing, undo, validating, previews and saving.\n\n` +
      `The File System Access API (${fsa}) adds: Save in place to the file you opened, a real Save As picker, Recent files, extracting into a folder, and Mount in pod.ini. Without it, saving and extracting download the result (several entries as a ZIP), and pod.ini mounting is unavailable.\n\n` +
      `Archives and staged files live in this site's private browser storage (OPFS) until you close the archive or clear temporary storage.`);
  }

  showAbout() {
    return alertDialog("About JSPod", "JSPod 2.1.1\n\nA web POD archive editor for Terminal Reality games by Kmaster.\n\nFile formats are read and written by OpenPhotex library.\n\n License: Apache-2.0.");
  }

  async autoloadFromPageQuery() {
    const params = new URLSearchParams(location.search);
    const raw = params.get("url") || params.get("file") || "";
    if (raw) await this.openUrl(raw);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ancestorsOfPath(path) {
  const parts = toEntryName(path).split("\\").filter(Boolean);
  const out = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("\\"));
  return out;
}

function ancestorsOf(entries) {
  const keys = new Set();
  for (const e of entries) {
    const parts = e.normalizedName.split("/");
    for (let i = 1; i < parts.length; i++) keys.add(parts.slice(0, i).join("/"));
  }
  return keys;
}

function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

const SETTINGS_KEY = "jspod.settings";

function loadSettings() {
  const defaults = { auditEnabled: true, auditAuthor: "jspod", keepStructure: true, listWidth: null };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience; a blocked storage is not an error worth showing.
  }
}
