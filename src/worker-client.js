export class WorkerClient {
  constructor(url) {
    this.worker = new Worker(url, { type: "module" });
    this.pending = new Map();
    this.nextId = 1;
    this.worker.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  /**
   * @param {string} type
   * @param {object} payload
   * @param {{onProgress?: (message: string) => void, transfer?: Transferable[]}} [options]
   */
  call(type, payload, { onProgress, transfer = [] } = {}) {
    const id = this.nextId++;
    this.worker.postMessage({ id, type, payload }, transfer);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
    });
  }

  terminate() {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) {
      reject(new Error("Worker terminated."));
    }
    this.pending.clear();
  }

  handleMessage(message) {
    const deferred = this.pending.get(message.id);
    if (!deferred) {
      return;
    }
    if (message.progress !== undefined) {
      deferred.onProgress?.(message.progress);
      return;
    }
    this.pending.delete(message.id);
    if (message.ok) {
      deferred.resolve(message.payload);
    } else {
      deferred.reject(new Error(message.error ?? "Worker error"));
    }
  }
}
