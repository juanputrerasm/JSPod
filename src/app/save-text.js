/* Saving a small text file: a save picker where the browser has one, a download otherwise. */
import { saveBlobAs } from "./disk.js";

export function saveTextAs(text, suggestedName, extension) {
  const blob = new Blob([new TextEncoder().encode(text)], { type: "text/plain" });
  return saveBlobAs(blob, suggestedName, { description: `${extension} file`, extensions: [extension] });
}
