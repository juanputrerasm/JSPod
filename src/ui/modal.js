let dialogEl = null;
let currentCleanup = null;

export function initModal(dialog) {
  dialogEl = dialog;
  dialog.addEventListener("close", () => {
    currentCleanup?.();
    currentCleanup = null;
  });
}

export function showModal({ title, body, onOk, onCancel }) {
  if (!dialogEl) throw new Error("Modal not initialized — call initModal() first.");
  // Clear previous content
  dialogEl.innerHTML = "";

  const h2 = document.createElement("h2");
  h2.className = "modal-title";
  h2.textContent = title;
  dialogEl.appendChild(h2);

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "modal-body";
  if (body instanceof Node) {
    bodyWrap.appendChild(body);
  } else {
    bodyWrap.innerHTML = String(body ?? "");
  }
  dialogEl.appendChild(bodyWrap);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const okBtn = document.createElement("button");
  okBtn.className = "btn btn-primary";
  okBtn.textContent = "OK";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = "Cancel";
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  dialogEl.appendChild(actions);

  return new Promise((resolve) => {
    const finish = (value) => {
      dialogEl.close();
      resolve(value);
    };
    okBtn.addEventListener("click", () => finish(onOk?.() ?? true));
    cancelBtn.addEventListener("click", () => finish(null));
    // Click on backdrop closes as cancel
    dialogEl.addEventListener("click", function backdropClick(e) {
      if (e.target === dialogEl) {
        dialogEl.removeEventListener("click", backdropClick);
        finish(null);
      }
    });
    currentCleanup = () => resolve(null);
    dialogEl.showModal();
  });
}
