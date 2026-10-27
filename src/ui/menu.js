/*
  The menu bar and the right-click menu.

  An item is "-" (a separator) or
    { label, action?, shortcut?, enabled?: () => boolean, checked?: () => boolean, submenu?: () => Item[] }
  enabled/checked/submenu are evaluated each time a menu opens, so menus always reflect the
  current state without being rebuilt by hand.
*/

let openMenu = null;

function closeOpenMenu() {
  openMenu?.close();
  openMenu = null;
}

document.addEventListener("pointerdown", (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeOpenMenu();
}, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openMenu) { e.stopPropagation(); closeOpenMenu(); }
}, true);
window.addEventListener("blur", closeOpenMenu);
window.addEventListener("resize", closeOpenMenu);

/** Builds a dropdown list for `items` and returns it, unattached. */
function buildList(items, onPick) {
  const ul = document.createElement("ul");
  ul.className = "menu-list";
  ul.setAttribute("role", "menu");
  for (const item of items) {
    if (item === "-") {
      const sep = document.createElement("li");
      sep.className = "menu-sep";
      sep.setAttribute("role", "separator");
      ul.appendChild(sep);
      continue;
    }
    const li = document.createElement("li");
    li.className = "menu-item";
    li.setAttribute("role", "menuitem");
    const enabled = item.enabled ? item.enabled() : true;
    if (!enabled) li.classList.add("disabled");
    const check = document.createElement("span");
    check.className = "menu-check";
    check.textContent = item.checked?.() ? "✓" : "";
    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = item.label;
    const shortcut = document.createElement("span");
    shortcut.className = "menu-shortcut";
    shortcut.textContent = item.submenu ? "▸" : (item.shortcut ?? "");
    li.append(check, label, shortcut);
    if (item.submenu && enabled) {
      li.classList.add("has-submenu");
      li.addEventListener("pointerenter", () => {
        ul.querySelectorAll(":scope > .menu-item > .menu-list").forEach((m) => m.remove());
        const sub = buildList(item.submenu(), onPick);
        sub.classList.add("submenu");
        li.appendChild(sub);
      });
    } else if (enabled && item.action) {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        onPick();
        item.action();
      });
    }
    ul.appendChild(li);
  }
  return ul;
}

export class MenuBar {
  /** @param {HTMLElement} container @param {{label: string, items: () => any[]}[]} menus */
  constructor(container, menus) {
    this.container = container;
    container.classList.add("menubar");
    container.setAttribute("role", "menubar");
    this.buttons = menus.map((menu) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menubar-button";
      button.textContent = menu.label;
      button.addEventListener("click", () => {
        if (openMenu?.owner === button) closeOpenMenu();
        else this.open(button, menu);
      });
      button.addEventListener("pointerenter", () => {
        if (openMenu && openMenu.owner !== button && this.buttons.includes(openMenu.owner)) this.open(button, menu);
      });
      container.appendChild(button);
      return button;
    });
  }

  open(button, menu) {
    closeOpenMenu();
    const list = buildList(menu.items(), closeOpenMenu);
    list.classList.add("menu-dropdown");
    const rect = button.getBoundingClientRect();
    list.style.left = `${rect.left}px`;
    list.style.top = `${rect.bottom}px`;
    document.body.appendChild(list);
    button.classList.add("open");
    openMenu = {
      owner: button,
      contains: (node) => list.contains(node) || button.contains(node),
      close: () => { list.remove(); button.classList.remove("open"); },
    };
  }
}

/** Opens a right-click menu at the pointer. */
export function showContextMenu(x, y, items) {
  closeOpenMenu();
  const list = buildList(items, closeOpenMenu);
  list.classList.add("menu-dropdown");
  document.body.appendChild(list);
  const { width, height } = list.getBoundingClientRect();
  list.style.left = `${Math.min(x, window.innerWidth - width - 4)}px`;
  list.style.top = `${Math.min(y, window.innerHeight - height - 4)}px`;
  openMenu = { owner: null, contains: (node) => list.contains(node), close: () => list.remove() };
}
