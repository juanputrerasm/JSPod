/*
  Text reports, as KPod's PodReportExporter writes them: UTF-8 without a BOM, CRLF line ends.

  .inf: a header, then one line per entry with the name, the size at column 30 and the offset at
  column 45. A name wider than its column pushes the rest right by one space.
  .lst: one entry name per line, which the response-list loader reads back.
*/
const SIZE_COLUMN = 30;
const OFFSET_COLUMN = 45;
const EOL = "\r\n";

/**
 * @param {{comment: string, entries: {name: string, length: number, offset: number}[]}} archive the saved archive
 * @param {string} fileName
 * @param {number} byteLength
 */
export function infoReport(archive, fileName, byteLength) {
  const lines = [
    `Pod Filename = ${fileName}`,
    `Pod Size     = ${byteLength}`,
    `Pod Entries  = ${archive.entries.length}`,
    `Pod Title    = ${archive.comment ?? ""}`,
    "",
    "Filename                     File Size      File Offset",
  ];
  for (const entry of archive.entries) {
    let line = entry.name.replace(/\0/g, " ").trim();
    line = padTo(line, SIZE_COLUMN) + entry.length;
    line = padTo(line, OFFSET_COLUMN) + entry.offset;
    lines.push(line.trimEnd());
  }
  return lines.join(EOL) + EOL;
}

export function listReport(archive) {
  return archive.entries.map((e) => e.name).join(EOL) + (archive.entries.length ? EOL : "");
}

function padTo(line, column) {
  return line.length >= column ? line + " " : line + " ".repeat(column - line.length);
}
