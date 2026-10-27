/*
  The Find panel: KPod's advanced search. Searches names and/or sizes, optionally matching case,
  and steps through the results with Find Next / Find Previous (both wrap around). It floats over
  the preview and does not block the list, so results can be edited as they are found.
*/
import { findEntries, stepIndex } from "../model/search.js";

export class SearchPanel {
  /** @param {{entries: () => object[], reveal: (entry: object) => void}} options */
  constructor({ entries, reveal }) {
    this.entries = entries;
    this.reveal = reveal;
    this.results = [];
    this.index = -1;
    this.el = document.createElement("div");
    this.el.className = "search-panel";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="search-panel-head"><strong>Find</strong><button type="button" class="quiet search-close" aria-label="Close">✕</button></div>
      <input type="search" class="modal-input search-text" placeholder="Name or size" spellcheck="false">
      <div class="search-options">
        <label><input type="checkbox" class="search-names" checked> Names</label>
        <label><input type="checkbox" class="search-sizes"> Sizes</label>
        <label><input type="checkbox" class="search-case"> Match case</label>
      </div>
      <div class="search-actions">
        <button type="button" class="btn btn-small search-prev">◀ Previous</button>
        <button type="button" class="btn btn-small btn-primary search-next">Next ▶</button>
        <span class="search-count"></span>
      </div>
      <ul class="search-results"></ul>`;
    document.body.appendChild(this.el);
    const q = (sel) => this.el.querySelector(sel);
    this.text = q(".search-text");
    this.count = q(".search-count");
    this.list = q(".search-results");
    const rerun = () => this.run();
    this.text.addEventListener("input", rerun);
    for (const sel of [".search-names", ".search-sizes", ".search-case"]) q(sel).addEventListener("change", rerun);
    q(".search-next").addEventListener("click", () => this.step(1));
    q(".search-prev").addEventListener("click", () => this.step(-1));
    q(".search-close").addEventListener("click", () => this.close());
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });
  }

  open() {
    this.el.hidden = false;
    this.text.focus();
    this.text.select();
    this.run();
  }

  close() {
    this.el.hidden = true;
  }

  run() {
    const q = (sel) => this.el.querySelector(sel);
    this.results = findEntries(this.entries(), {
      text: this.text.value,
      names: q(".search-names").checked,
      sizes: q(".search-sizes").checked,
      matchCase: q(".search-case").checked,
    });
    this.index = -1;
    this.count.textContent = this.text.value ? `${this.results.length} found` : "";
    const fragment = document.createDocumentFragment();
    for (const [i, entry] of this.results.slice(0, 200).entries()) {
      const li = document.createElement("li");
      li.textContent = `${entry.name}  (${entry.length.toLocaleString()})`;
      li.addEventListener("click", () => { this.index = i; this.show(); });
      fragment.appendChild(li);
    }
    this.list.replaceChildren(fragment);
  }

  step(direction) {
    // Entries are replaced by edits, so look the results up again before stepping.
    const ids = new Set(this.entries().map((e) => e.id));
    if (this.results.some((e) => !ids.has(e.id))) {
      const at = this.index;
      this.run();
      this.index = Math.min(at, this.results.length - 1);
    }
    this.index = stepIndex(this.index, this.results.length, direction);
    this.show();
  }

  show() {
    const entry = this.results[this.index];
    if (!entry) return;
    this.count.textContent = `${this.index + 1} of ${this.results.length}`;
    [...this.list.children].forEach((li, i) => li.classList.toggle("active", i === this.index));
    this.reveal(entry);
  }
}
