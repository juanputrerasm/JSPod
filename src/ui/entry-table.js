import { getFileTypeInfo, getRawDescription } from "../file-type-info.js";

export class EntryTable {
  constructor(container, { onSelect, onSort }) {
    this.container = container;
    this.onSelect  = onSelect;
    this.onSort    = onSort;
    this._build();
  }

  _build() {
    this.table = document.createElement("table");
    this.table.className = "entry-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    this._headers = [];
    for (const col of ["Name", "Description"]) {
      const th = document.createElement("th");
      th.dataset.col = col.toLowerCase();
      th.textContent = col;
      th.className = "sortable";
      th.addEventListener("click", () => this.onSort(col.toLowerCase()));
      headerRow.appendChild(th);
      this._headers.push(th);
    }
    thead.appendChild(headerRow);
    this.table.appendChild(thead);

    this.tbody = document.createElement("tbody");
    this.table.appendChild(this.tbody);
    this.container.appendChild(this.table);
  }

  update(rows, sortCol, sortDir, selectedEntry) {
    // Update header indicators
    for (const th of this._headers) {
      th.dataset.sort = th.dataset.col === sortCol ? sortDir : "";
    }
    this.tbody.innerHTML = "";
    for (const entry of rows) {
      const info = getFileTypeInfo(entry.title);
      const desc = getRawDescription(entry.title, entry.length);
      const tr = document.createElement("tr");
      tr.className = entry === selectedEntry ? "selected" : "";
      tr.dataset.name = entry.normalizedName;

      const tdName = document.createElement("td");
      tdName.className = "col-name";
      const iconSpan = document.createElement("span");
      iconSpan.className = "file-icon";
      iconSpan.textContent = info.icon;
      const nameSpan = document.createElement("span");
      nameSpan.textContent = entry.title;
      tdName.appendChild(iconSpan);
      tdName.appendChild(nameSpan);

      const tdDesc = document.createElement("td");
      tdDesc.className = "col-desc";
      tdDesc.textContent = desc;

      tr.appendChild(tdName);
      tr.appendChild(tdDesc);
      tr.addEventListener("click", () => this.onSelect(entry));
      this.tbody.appendChild(tr);
    }
  }
}
