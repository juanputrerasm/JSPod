/*
  Modal dialogs. Each call creates its own <dialog>, so dialogs can stack (a confirmation over
  the search dialog) and are removed when closed. Styling reuses the .main-dialog classes.
*/

/**
 * Opens a dialog and resolves with the value of the button pressed, or null on Escape/backdrop.
 * @param {{title: string, body?: Node|string, buttons?: {label: string, value: any, primary?: boolean, danger?: boolean}[],
 *          wide?: boolean, onOpen?: (dialog: HTMLDialogElement) => void,
 *          beforeClose?: (value: any) => boolean}} options beforeClose may return false to keep the dialog open
 */
export function openDialog({ title, body = "", buttons = [{ label: "OK", value: true, primary: true }], wide = false, onOpen, beforeClose }) {
  const dialog = document.createElement("dialog");
  dialog.className = "main-dialog" + (wide ? " dialog-wide" : "");
  const h2 = document.createElement("h2");
  h2.className = "modal-title";
  h2.textContent = title;
  const content = document.createElement("div");
  content.className = "modal-body";
  if (body instanceof Node) content.appendChild(body);
  else content.textContent = String(body);
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  dialog.append(h2, content, actions);
  document.body.appendChild(dialog);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      if (value !== null && beforeClose && beforeClose(value) === false) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    for (const button of buttons) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "btn" + (button.primary ? " btn-primary" : "") + (button.danger ? " btn-danger" : "");
      el.textContent = button.label;
      el.addEventListener("click", () => finish(button.value));
      actions.appendChild(el);
    }
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    dialog.addEventListener("click", (e) => { if (e.target === dialog) finish(null); });
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement) return;
      const primary = buttons.find((b) => b.primary);
      if (primary) { e.preventDefault(); finish(primary.value); }
    });
    dialog.showModal();
    onOpen?.(dialog);
    const focusable = content.querySelector("input, select, textarea") ?? actions.querySelector(".btn-primary");
    focusable?.focus();
    if (focusable instanceof HTMLInputElement) focusable.select();
  });
}

export function alertDialog(title, message) {
  return openDialog({ title, body: textBody(message) });
}

/** @returns {Promise<boolean>} */
export async function confirmDialog(title, message, { okLabel = "OK", danger = false } = {}) {
  const value = await openDialog({
    title,
    body: textBody(message),
    buttons: [{ label: "Cancel", value: false }, { label: okLabel, value: true, primary: true, danger }],
  });
  return value === true;
}

/**
 * Asks for one line of text. `validate` returns an error message to show, or null to accept.
 * @returns {Promise<string|null>}
 */
export async function promptDialog(title, label, value = "", { validate, hint, okLabel = "OK" } = {}) {
  const wrap = document.createElement("div");
  const field = document.createElement("label");
  field.className = "modal-field-label";
  field.textContent = label;
  const input = document.createElement("input");
  input.className = "modal-input";
  input.type = "text";
  input.value = value;
  input.spellcheck = false;
  field.appendChild(input);
  wrap.appendChild(field);
  if (hint) wrap.appendChild(hintEl(hint));
  const error = document.createElement("p");
  error.className = "modal-error";
  wrap.appendChild(error);
  const result = await openDialog({
    title,
    body: wrap,
    buttons: [{ label: "Cancel", value: null }, { label: okLabel, value: "ok", primary: true }],
    beforeClose: () => {
      const message = validate?.(input.value) ?? null;
      error.textContent = message ?? "";
      return !message;
    },
  });
  return result === "ok" ? input.value : null;
}

/**
 * Lets the user pick one of several options.
 * @param {{label: string, value: any, description?: string}[]} options
 */
export async function chooseDialog(title, message, options, { okLabel = "OK", initial } = {}) {
  const wrap = document.createElement("div");
  if (message) wrap.appendChild(textBody(message));
  const name = `choice-${Math.random().toString(36).slice(2)}`;
  const radios = options.map((option, i) => {
    const row = document.createElement("label");
    row.className = "choice-row";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = name;
    radio.checked = initial === undefined ? i === 0 : option.value === initial;
    const text = document.createElement("span");
    text.innerHTML = `<strong></strong>${option.description ? "<br><small></small>" : ""}`;
    text.querySelector("strong").textContent = option.label;
    if (option.description) text.querySelector("small").textContent = option.description;
    row.append(radio, text);
    wrap.appendChild(row);
    return radio;
  });
  const result = await openDialog({
    title,
    body: wrap,
    buttons: [{ label: "Cancel", value: null }, { label: okLabel, value: "ok", primary: true }],
  });
  if (result !== "ok") return null;
  return options[radios.findIndex((r) => r.checked)]?.value ?? null;
}

/** A dialog listing errors and warnings, or a success message. */
export function reportDialog(title, { errors = [], warnings = [], ok = "No problems found." }) {
  const wrap = document.createElement("div");
  if (!errors.length && !warnings.length) wrap.appendChild(textBody(ok));
  for (const [list, cls, heading] of [[errors, "report-error", "Errors"], [warnings, "report-warning", "Warnings"]]) {
    if (!list.length) continue;
    const h = document.createElement("h3");
    h.className = "report-heading";
    h.textContent = `${heading} (${list.length})`;
    const ul = document.createElement("ul");
    ul.className = `report-list ${cls}`;
    for (const item of list) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    wrap.append(h, ul);
  }
  return openDialog({ title, body: wrap, wide: true });
}

export function textBody(message) {
  const wrap = document.createElement("div");
  for (const paragraph of String(message ?? "").split("\n\n")) {
    const p = document.createElement("p");
    p.className = "modal-text";
    p.textContent = paragraph;
    wrap.appendChild(p);
  }
  return wrap;
}

export function hintEl(text) {
  const p = document.createElement("p");
  p.className = "modal-hint";
  p.textContent = text;
  return p;
}
