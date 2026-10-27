/*
  The entry list: a tree table with Name, Size and Description columns.

  Rows come from src/model/browser.js buildRows. Only the visible rows are in the DOM (fixed row
  height), so an 8,192-entry archive redraws instantly after every edit.

  Selection: click selects, Ctrl/Cmd-click toggles, Shift-click selects a range. Keyboard: arrows,
  Home/End, Shift+arrows, Enter (preview a file, open or close a folder), Left/Right (close or
  open a folder). Other keys go to the app (Delete, F2, ...).

  Drag and drop: rows dragged onto a folder (or onto a file, meaning its folder, or onto the empty
  area, meaning the root) are moved there; files dropped from the desktop are added there.
*/
import { getFileTypeInfo, formatFileSize } from "../file-type-info.js";
import { describeEntry } from "../model/browser.js";
import { parentPath } from "../model/paths.js";

const ROW_HEIGHT = 22;
const OVERSCAN = 12;
const DRAG_TYPE = "application/x-jspod-entries";

export class EntryList {
  /**
   * @param {HTMLElement} container
   * @param {object} handlers
   * @param {(row: object) => void} handlers.onFocus a file row became the focused row (preview it)
   * @param {(row: object) => void} handlers.onActivate Enter or double-click
   * @param {(key: string) => void} handlers.onToggle open or close a folder
   * @param {(column: string) => void} handlers.onSort
   * @param {(event: MouseEvent, row: object|null) => void} handlers.onContextMenu
   * @param {(targetFolder: string) => void} handlers.onMoveSelection
   * @param {(dataTransfer: DataTransfer, targetFolder: string) => void} handlers.onDropFiles
   * @param {() => void} handlers.onSelectionChange
   * @param {(event: KeyboardEvent) => void} handlers.onKey keys the list does not handle itself
   */
  constructor(container, handlers) {
    this.handlers = handlers;
    this.rows = [];
    this.selected = new Set();
    this.focusIndex = -1;
    this.anchorIndex = -1;
    this.sort = null;

    container.classList.add("entry-list");
    this.header = document.createElement("div");
    this.header.className = "entry-header";
    this.columns = {};
    for (const [column, label] of [["name", "Name"], ["size", "Size"], ["description", "Description"]]) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `entry-col entry-col-${column}`;
      cell.textContent = label;
      cell.addEventListener("click", () => handlers.onSort(column));
      this.header.appendChild(cell);
      this.columns[column] = cell;
    }
    this.scroller = document.createElement("div");
    this.scroller.className = "entry-scroller";
    this.scroller.tabIndex = 0;
    this.spacer = document.createElement("div");
    this.spacer.className = "entry-spacer";
    this.scroller.appendChild(this.spacer);
    container.replaceChildren(this.header, this.scroller);

    this.scroller.addEventListener("scroll", () => this.paint());
    new ResizeObserver(() => this.paint()).observe(this.scroller);
    this.scroller.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.scroller.addEventListener("contextmenu", (e) => {
      if (e.target === this.scroller || e.target === this.spacer) {
        e.preventDefault();
        handlers.onContextMenu(e, null);
      }
    });
    this.scroller.addEventListener("click", (e) => {
      if (e.target === this.scroller || e.target === this.spacer) {
        this.selected.clear();
        this.paint();
        handlers.onSelectionChange();
      }
    });
    this.setupDrop(this.scroller, () => "");
  }

  /** Replaces the rows, keeping the selection of rows that still exist. */
  setRows(rows, sort) {
    const focusKey = this.rows[this.focusIndex] ? rowKey(this.rows[this.focusIndex]) : null;
    this.rows = rows;
    this.sort = sort;
    const keys = new Set(rows.map(rowKey));
    for (const key of [...this.selected]) if (!keys.has(key)) this.selected.delete(key);
    this.focusIndex = focusKey ? rows.findIndex((r) => rowKey(r) === focusKey) : -1;
    for (const [column, cell] of Object.entries(this.columns)) {
      cell.dataset.sort = sort?.column === column ? sort.dir : "";
    }
    this.spacer.style.height = `${rows.length * ROW_HEIGHT}px`;
    this.paint();
  }

  /** The selected entries and folder paths. */
  getSelection() {
    const entries = [];
    const folders = [];
    for (const row of this.rows) {
      if (!this.selected.has(rowKey(row))) continue;
      if (row.kind === "file") entries.push(row.entry);
      else folders.push(row.path);
    }
    return { entries, folders };
  }

  focusedRow() {
    return this.rows[this.focusIndex] ?? null;
  }

  /** Selects the rows for these entries (by id), focusing the first. */
  selectEntries(ids, { focus = true } = {}) {
    const wanted = new Set(ids);
    this.selected = new Set(this.rows.filter((r) => r.kind === "file" && wanted.has(r.entry.id)).map(rowKey));
    const first = this.rows.findIndex((r) => r.kind === "file" && wanted.has(r.entry.id));
    if (focus && first >= 0) {
      this.focusIndex = this.anchorIndex = first;
      this.scrollIntoView(first);
    }
    this.paint();
    this.handlers.onSelectionChange();
  }

  selectAll() {
    this.selected = new Set(this.rows.map(rowKey));
    this.paint();
    this.handlers.onSelectionChange();
  }

  focus() {
    this.scroller.focus();
  }

  scrollIntoView(index) {
    const top = index * ROW_HEIGHT;
    const view = this.scroller.clientHeight;
    if (top < this.scroller.scrollTop) this.scroller.scrollTop = top;
    else if (top + ROW_HEIGHT > this.scroller.scrollTop + view) this.scroller.scrollTop = top + ROW_HEIGHT - view;
  }

  paint() {
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(this.rows.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
    const fragment = document.createDocumentFragment();
    for (let i = first; i < last; i++) fragment.appendChild(this.renderRow(this.rows[i], i));
    this.spacer.replaceChildren(fragment);
  }

  renderRow(row, index) {
    const el = document.createElement("div");
    el.className = `entry-row entry-${row.kind}`;
    if (this.selected.has(rowKey(row))) el.classList.add("selected");
    if (index === this.focusIndex) el.classList.add("focused");
    el.style.top = `${index * ROW_HEIGHT}px`;
    el.draggable = true;

    const name = document.createElement("span");
    name.className = "entry-cell entry-name";
    name.style.paddingLeft = `${row.depth * 14 + 4}px`;
    const size = document.createElement("span");
    size.className = "entry-cell entry-size";
    const description = document.createElement("span");
    description.className = "entry-cell entry-description";

    if (row.kind === "folder") {
      const arrow = document.createElement("span");
      arrow.className = "tree-arrow";
      arrow.textContent = row.collapsed ? "▶" : "▼";
      arrow.addEventListener("click", (e) => { e.stopPropagation(); this.handlers.onToggle(row.key); });
      const label = document.createElement("span");
      label.className = "entry-label";
      label.textContent = `📁 ${row.label}`;
      const badge = document.createElement("span");
      badge.className = "tree-badge";
      badge.textContent = row.count;
      name.append(arrow, label, badge);
      size.textContent = formatFileSize(row.size);
      description.textContent = "Folder";
    } else {
      const label = document.createElement("span");
      label.className = "entry-label";
      label.textContent = `${getFileTypeInfo(row.entry.title).icon} ${row.entry.title}`;
      name.appendChild(label);
      if (row.entry.source.kind === "blob") {
        const mark = document.createElement("span");
        mark.className = "entry-unsaved";
        mark.title = "Added or changed since the last save";
        mark.textContent = "●";
        name.appendChild(mark);
      }
      size.textContent = row.entry.length.toLocaleString();
      description.textContent = describeEntry(row.entry);
    }
    el.title = row.kind === "folder" ? row.path : row.entry.name;
    el.append(name, size, description);

    el.addEventListener("click", (e) => this.onRowClick(e, index));
    el.addEventListener("dblclick", () => this.activate(index));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!this.selected.has(rowKey(row))) this.selectOnly(index);
      this.handlers.onContextMenu(e, row);
    });
    el.addEventListener("dragstart", (e) => {
      if (!this.selected.has(rowKey(row))) this.selectOnly(index);
      e.dataTransfer.setData(DRAG_TYPE, "1");
      e.dataTransfer.effectAllowed = "move";
    });
    this.setupDrop(el, () => (row.kind === "folder" ? row.path : parentPath(row.entry.name)));
    return el;
  }

  setupDrop(el, targetFolder) {
    el.addEventListener("dragover", (e) => {
      const types = [...e.dataTransfer.types];
      if (!types.includes(DRAG_TYPE) && !types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = types.includes(DRAG_TYPE) ? "move" : "copy";
      el.classList.add("drop-target");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
    el.addEventListener("drop", (e) => {
      el.classList.remove("drop-target");
      const types = [...e.dataTransfer.types];
      if (!types.includes(DRAG_TYPE) && !types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      if (types.includes(DRAG_TYPE)) this.handlers.onMoveSelection(targetFolder());
      else this.handlers.onDropFiles(e.dataTransfer, targetFolder());
    });
  }

  onRowClick(e, index) {
    const row = this.rows[index];
    if (e.shiftKey && this.anchorIndex >= 0) {
      this.selectRange(this.anchorIndex, index, e.ctrlKey || e.metaKey);
      this.focusIndex = index;
    } else if (e.ctrlKey || e.metaKey) {
      const key = rowKey(row);
      if (this.selected.has(key)) this.selected.delete(key);
      else this.selected.add(key);
      this.focusIndex = this.anchorIndex = index;
    } else {
      this.selectOnly(index);
    }
    this.paint();
    this.handlers.onSelectionChange();
    if (row.kind === "file" && !e.shiftKey && !(e.ctrlKey || e.metaKey)) this.handlers.onFocus(row);
    this.scroller.focus({ preventScroll: true });
  }

  selectOnly(index) {
    this.selected = new Set([rowKey(this.rows[index])]);
    this.focusIndex = this.anchorIndex = index;
    this.paint();
    this.handlers.onSelectionChange();
  }

  selectRange(from, to, additive) {
    if (!additive) this.selected.clear();
    const [a, b] = from < to ? [from, to] : [to, from];
    for (let i = a; i <= b; i++) this.selected.add(rowKey(this.rows[i]));
  }

  activate(index) {
    const row = this.rows[index];
    if (!row) return;
    if (row.kind === "folder") this.handlers.onToggle(row.key);
    else this.handlers.onActivate(row);
  }

  onKeyDown(e) {
    const count = this.rows.length;
    const move = (to) => {
      if (!count) return;
      const index = Math.max(0, Math.min(count - 1, to));
      if (e.shiftKey && this.anchorIndex >= 0) this.selectRange(this.anchorIndex, index, false);
      else { this.selected = new Set([rowKey(this.rows[index])]); this.anchorIndex = index; }
      this.focusIndex = index;
      this.scrollIntoView(index);
      this.paint();
      this.handlers.onSelectionChange();
      const row = this.rows[index];
      if (row.kind === "file" && !e.shiftKey) this.handlers.onFocus(row);
    };
    const page = Math.max(1, Math.floor(this.scroller.clientHeight / ROW_HEIGHT) - 1);
    const row = this.rows[this.focusIndex];
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(this.focusIndex + 1); return;
      case "ArrowUp": e.preventDefault(); move(this.focusIndex < 0 ? 0 : this.focusIndex - 1); return;
      case "PageDown": e.preventDefault(); move(this.focusIndex + page); return;
      case "PageUp": e.preventDefault(); move(this.focusIndex - page); return;
      case "Home": e.preventDefault(); move(0); return;
      case "End": e.preventDefault(); move(count - 1); return;
      case "Enter": e.preventDefault(); this.activate(this.focusIndex); return;
      case "ArrowRight":
        if (row?.kind === "folder" && row.collapsed) { e.preventDefault(); this.handlers.onToggle(row.key); }
        return;
      case "ArrowLeft":
        if (row?.kind === "folder" && !row.collapsed) { e.preventDefault(); this.handlers.onToggle(row.key); }
        return;
      default:
        this.handlers.onKey(e);
    }
  }
}

function rowKey(row) {
  return row.kind === "folder" ? `d:${row.key}` : `f:${row.entry.id}`;
}
