import { PodDocument, makeEntry } from "../src/model/pod-document.js";

export function blob(name, length, extra = {}) {
  return { name, length, source: { kind: "blob", path: `blobs/${name}` }, ...extra };
}

export function doc(names, init = {}) {
  const d = new PodDocument({ format: "pod1", ...init, entries: names.map((n, i) => makeEntry(blob(n, 10 + i))) });
  d.now = () => 1000;
  return d;
}
