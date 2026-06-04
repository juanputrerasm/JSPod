import { getFileTypeInfo } from "../file-type-info.js";

export class FileTree {
  constructor(container, { onSelect, onToggle }) {
    this.container = container;
    this.onSelect  = onSelect;
    this.onToggle  = onToggle;
  }

  update(entries, collapsedFolders, searchTerm, selectedEntry) {
    const tree  = buildFolderTree(entries, searchTerm);
    const ul    = document.createElement("ul");
    ul.className = "file-tree-root";
    renderNode(ul, tree, collapsedFolders, this.onSelect, this.onToggle, selectedEntry, 0);
    this.container.innerHTML = "";
    this.container.appendChild(ul);
  }
}

function buildFolderTree(entries, searchTerm) {
  const term = searchTerm ? searchTerm.toUpperCase() : "";
  const root = { folders: new Map(), files: [] };

  for (const entry of entries) {
    if (term && !entry.normalizedName.includes(term)) continue;
    const parts = entry.normalizedName.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join("/");
      if (!node.folders.has(key)) {
        node.folders.set(key, { label: parts[i], key, folders: new Map(), files: [] });
      }
      node = node.folders.get(key);
    }
    node.files.push(entry);
  }
  return root;
}

function renderNode(parent, node, collapsedFolders, onSelect, onToggle, selectedEntry, depth) {
  // Render folders
  for (const folder of node.folders.values()) {
    const collapsed = collapsedFolders.has(folder.key);
    const li = document.createElement("li");
    li.className = "tree-folder";

    const row = document.createElement("div");
    row.className = "tree-row tree-folder-row";
    row.style.paddingLeft = `${depth * 14 + 6}px`;
    row.dataset.key = folder.key;

    const arrow = document.createElement("span");
    arrow.className = "tree-arrow";
    arrow.textContent = collapsed ? "▶" : "▼";
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.textContent = "📁";
    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = folder.label;
    const count = countFiles(folder);
    const badge = document.createElement("span");
    badge.className = "tree-badge";
    badge.textContent = count;

    row.appendChild(arrow);
    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(badge);
    row.addEventListener("click", () => onToggle(folder.key));
    li.appendChild(row);

    if (!collapsed) {
      const childUl = document.createElement("ul");
      childUl.className = "tree-children";
      renderNode(childUl, folder, collapsedFolders, onSelect, onToggle, selectedEntry, depth + 1);
      li.appendChild(childUl);
    }
    parent.appendChild(li);
  }

  // Render files
  for (const entry of node.files) {
    const li  = document.createElement("li");
    li.className = "tree-file";
    const row = document.createElement("div");
    row.className = "tree-row tree-file-row" + (entry === selectedEntry ? " selected" : "");
    row.style.paddingLeft = `${depth * 14 + 20}px`;

    const info = getFileTypeInfo(entry.title);
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.textContent = info.icon;
    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = entry.title;

    row.appendChild(icon);
    row.appendChild(label);
    row.addEventListener("click", () => onSelect(entry));
    li.appendChild(row);
    parent.appendChild(li);
  }
}

function countFiles(node) {
  let n = node.files.length;
  for (const child of node.folders.values()) n += countFiles(child);
  return n;
}
