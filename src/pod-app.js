import { WorkerClient }   from "./worker-client.js";
import { extractFirstPodFromZipBytes } from "./zip-utils.js";
import { writeBytesToFile, resetSessionFolder } from "./shared/opfs.js";
import { FileTree }       from "./ui/file-tree.js";
import { initModal }      from "./ui/modal.js";
import { dispatch }       from "./preview/preview-dispatcher.js";
import { formatFileSize, getFileTypeInfo, getRawDescription } from "./file-type-info.js";

const SESSION_ID  = "jspod";
const OPFS_POD    = `sessions/${SESSION_ID}/current.pod`;

export class PodApp {
  constructor() {
    this.workerClient = null;
    this.podIndex     = null;
    this.collapsedFolders = new Set();
    this.searchTerm   = "";
    this.selectedEntry = null;
    this.entryBytesCache = new Map();
    this.loading      = false;
    this.fileTree     = null;
  }

  mount(doc) {
    this.doc = doc;
    this.workerClient = new WorkerClient(new URL("./worker/pod-worker.js", import.meta.url));
    this.cacheDom();
    initModal(this.modalEl);
    this.fileTree = new FileTree(this.treeContainer, {
      onSelect: (e) => this.handleEntrySelect(e),
      onToggle: (key) => this.handleFolderToggle(key)
    });
    this.fileInput.addEventListener("change", () => this.handleLocalFile());
    this.openFileBtn.addEventListener("click", () => this.fileInput.click());
    this.openUrlBtn.addEventListener("click", () => this.handleUrlOpen());
    this.clearBtn.addEventListener("click", () => this.clearSession());
    this.searchInput.addEventListener("input", () => this.handleSearch(this.searchInput.value));
    this.downloadAllBtn.addEventListener("click", () => this.handleDownloadAll());
    this.expandAllBtn.addEventListener("click", () => this.handleExpandAll());
    this.collapseAllBtn.addEventListener("click", () => this.handleCollapseAll());
    this.renderIdleState();
    void this.autoloadFromPageQuery();
  }

  cacheDom() {
    const $ = (id) => this.doc.getElementById(id);
    this.fileInput      = $("file-input");
    this.openFileBtn    = $("open-file-btn");
    this.urlInput       = $("url-input");
    this.openUrlBtn     = $("open-url-btn");
    this.clearBtn       = $("clear-btn");
    this.searchInput    = $("search-input");
    this.downloadAllBtn = $("download-all-btn");
    this.expandAllBtn   = $("expand-all-btn");
    this.collapseAllBtn = $("collapse-all-btn");
    this.treeContainer  = $("file-tree");
    this.previewContent = $("preview-content");
    this.previewMeta    = $("preview-meta");
    this.archiveInfoBar = $("archive-info");
    this.statusBar      = $("status-bar");
    this.loadingOverlay = $("loading-overlay");
    this.loadingMsg     = $("loading-msg");
    this.modalEl        = $("main-dialog");
  }

  // ─── Loading ────────────────────────────────────────────────────────────────
  async withLoading(message, work) {
    if (this.loading) return;
    this.loading = true;
    this.setControlsEnabled(false);
    this.setStatus(message);
    this.loadingOverlay.hidden = false;
    this.loadingMsg.textContent = message;
    try {
      await work();
    } catch (err) {
      this.setStatus(`Error: ${err.message}`);
    } finally {
      this.loading = false;
      this.loadingOverlay.hidden = true;
      this.setControlsEnabled(true);
    }
  }

  setControlsEnabled(enabled) {
    for (const el of [
      this.openFileBtn, this.openUrlBtn, this.clearBtn,
      this.downloadAllBtn, this.urlInput
    ]) {
      el.disabled = !enabled;
    }
  }

  setStatus(msg) {
    this.statusBar.textContent = msg;
  }

  // ─── File loading ────────────────────────────────────────────────────────────
  async handleLocalFile() {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    await this.withLoading(`Reading ${file.name}…`, async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.stagePodBytes(bytes, file.name);
    });
    this.fileInput.value = "";
  }

  async handleUrlOpen() {
    const raw = this.urlInput.value.trim();
    if (!raw) { this.setStatus("Enter a POD or ZIP URL first."); return; }
    let url;
    try { url = new URL(raw, document.baseURI).toString(); } catch { url = raw; }
    this.urlInput.value = url;
    await this.withLoading(`Fetching ${url}…`, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await this.stagePodBytes(bytes, url.split("/").pop() || "archive");
    });
  }

  async stagePodBytes(bytes, sourceName) {
    let podBytes = bytes;
    let podName  = sourceName;
    const upperName = sourceName.toUpperCase();
    if (upperName.endsWith(".ZIP")) {
      this.loadingMsg.textContent = "Extracting ZIP…";
      const result = await extractFirstPodFromZipBytes(bytes, sourceName);
      podBytes = result.podBytes;
      podName  = result.podEntryName;
    } else if (!upperName.endsWith(".POD") && !upperName.endsWith(".EPD")) {
      throw new Error("Only .pod, .epd, and .zip (containing .pod) files are supported.");
    }
    this.loadingMsg.textContent = "Storing to OPFS…";
    await resetSessionFolder(SESSION_ID);
    await writeBytesToFile(OPFS_POD, podBytes);
    this.entryBytesCache.clear();
    this.loadingMsg.textContent = "Indexing archive…";
    const podIndex = await this.workerClient.call("indexPod", { opfsPodPath: OPFS_POD });
    this.podIndex = podIndex;
    this.collapsedFolders = new Set(getAllFolderKeys(podIndex.entries));
    this.searchTerm = ""; this.searchInput.value = "";
    this.selectedEntry = null;
    this.renderArchive(podName);
    this.setStatus(`Loaded ${podName} · ${podIndex.format} · ${podIndex.entries.length} entries`);
  }

  // ─── Session management ──────────────────────────────────────────────────────
  async clearSession() {
    await resetSessionFolder(SESSION_ID).catch(() => {});
    this.podIndex = null;
    this.entryBytesCache.clear();
    this.selectedEntry = null;
    this.renderIdleState();
    this.setStatus("Session cleared.");
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────
  renderIdleState() {
    this.archiveInfoBar.textContent = "No archive loaded. Open a POD, EPD, or ZIP file.";
    this.treeContainer.innerHTML  = "";
    this.previewContent.innerHTML = '<p class="preview-placeholder">Select a file to preview it here.</p>';
    this.previewMeta.innerHTML    = "";
    this.downloadAllBtn.disabled  = true;
  }

  renderArchive(sourceName) {
    const { format, comment, entries } = this.podIndex;
    const totalBytes = entries.reduce((s, e) => s + e.length, 0);
    let info = `${sourceName}  ·  ${format}  ·  ${entries.length} files  ·  ${formatFileSize(totalBytes)}`;
    if (comment) info += `  ·  "${comment}"`;
    this.archiveInfoBar.textContent = info;
    this.downloadAllBtn.disabled = false;
    this.updateDisplay();
  }

  updateDisplay() {
    if (!this.podIndex) return;
    this.fileTree.update(this.podIndex.entries, this.collapsedFolders, this.searchTerm, this.selectedEntry);
  }

  // ─── Event handlers ──────────────────────────────────────────────────────────
  handleFolderToggle(key) {
    if (this.collapsedFolders.has(key)) {
      this.collapsedFolders.delete(key);
    } else {
      this.collapsedFolders.add(key);
    }
    this.updateDisplay();
  }

  handleExpandAll() {
    this.collapsedFolders.clear();
    this.updateDisplay();
  }

  handleCollapseAll() {
    if (this.podIndex) {
      this.collapsedFolders = new Set(getAllFolderKeys(this.podIndex.entries));
    }
    this.updateDisplay();
  }

  handleSearch(term) {
    this.searchTerm = term;
    this.updateDisplay();
  }

  async handleEntrySelect(entry) {
    this.selectedEntry = entry;
    this.updateDisplay();
    this.renderMetadata(entry);
    await this.withLoading(`Loading ${entry.title}…`, async () => {
      const bytes = await this.getEntryBytes(entry);
      await dispatch(this.previewContent, bytes, {
        entry,
        podIndex: this.podIndex,
        workerClient: this.workerClient,
        opfsPodPath: OPFS_POD,
        selectEntry: (e) => this.handleEntrySelect(e)
      });
    });
  }

  async getEntryBytes(entry) {
    const key = `${entry.offset}:${entry.length}`;
    if (this.entryBytesCache.has(key)) return this.entryBytesCache.get(key);
    const result = await this.workerClient.call("readEntryBytes", {
      opfsPodPath: OPFS_POD,
      entry
    });
    const bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes);
    this.entryBytesCache.set(key, bytes);
    return bytes;
  }

  renderMetadata(entry) {
    const info = getFileTypeInfo(entry.title);
    const desc = getRawDescription(entry.title, entry.length);
    this.previewMeta.innerHTML = `
      <dl class="meta-list">
        <dt>Path</dt><dd>${escapeHtml(entry.name)}</dd>
        <dt>Size</dt><dd>${formatFileSize(entry.length)} (${entry.length} bytes)</dd>
        <dt>Format</dt><dd>${escapeHtml(desc)}</dd>
        <dt>Offset</dt><dd>${entry.offset}</dd>
      </dl>
      <div class="meta-actions">
        <button class="btn btn-primary" id="download-selected-btn">⬇ Download</button>
      </div>`;
    this.doc.getElementById("download-selected-btn")?.addEventListener("click", () => {
      this.handleDownloadSelected(entry);
    });
  }

  async handleDownloadSelected(entry) {
    try {
      const bytes = await this.getEntryBytes(entry);
      triggerDownload(bytes, entry.title);
    } catch (err) {
      this.setStatus(`Download error: ${err.message}`);
    }
  }

  async handleDownloadAll() {
    if (!this.podIndex) return;
    await this.withLoading("Preparing ZIP download…", async () => {
      const { zipSync } = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
      const fileMap = {};
      for (const entry of this.podIndex.entries) {
        this.loadingMsg.textContent = `Packing ${entry.title}…`;
        const bytes = await this.getEntryBytes(entry);
        // Preserve archive path in ZIP
        fileMap[entry.name.replace(/\\/g, "/")] = bytes;
      }
      const zipped = zipSync(fileMap);
      const podName = this.podIndex.comment?.split(/\s/)[0] || "archive";
      triggerDownload(zipped, `${podName}.zip`);
    });
  }

  async autoloadFromPageQuery() {
    const location = this.doc.defaultView?.location;
    if (!location) return;
    const params = new URLSearchParams(location.search);
    const raw = params.get("url") || params.get("file") || "";
    if (!raw) return;
    let url;
    try { url = new URL(raw, location.href).toString(); } catch { url = raw; }
    this.urlInput.value = url;
    await this.withLoading(`Loading ${url}…`, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await this.stagePodBytes(bytes, url.split("/").pop() || "archive");
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function filterEntries(entries, term) {
  if (!term) return entries;
  const upper = term.toUpperCase();
  return entries.filter((e) => e.normalizedName.includes(upper));
}

function getAllFolderKeys(entries) {
  const keys = new Set();
  for (const entry of entries) {
    const parts = entry.normalizedName.split("/");
    for (let i = 1; i < parts.length; i++) {
      keys.add(parts.slice(0, i).join("/"));
    }
  }
  return keys;
}

function triggerDownload(bytes, filename) {
  const blob = new Blob([bytes]);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
