/*
  Response list (.lst / .rsp) files: a plain-text recipe for an archive. Port of KPod's
  PodManifestParser.

    // comment                     ignored, as are blank lines
    podFilename: TRACK.POD         the archive's file name
    volumeName: My Track           the archive comment
    ART\ROCK.RAW                   a file, stored under the same name
    rock.raw,ART\ROCK.RAW          a file read as "rock.raw", stored as ART\ROCK.RAW

  Entry names are upper-cased, the Terminal Reality convention. Files are looked up next to the
  list first, then one folder up (resolveCandidates).
*/

export function parseResponseList(text) {
  let podFilename = "noname.pod";
  let volumeName = "";
  const items = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (/^podFilename:/i.test(line)) { podFilename = line.slice(12).trim(); continue; }
    if (/^volumeName:/i.test(line)) { volumeName = line.slice(11).trim(); continue; }
    const comma = line.indexOf(",");
    const file = comma > 0 ? line.slice(0, comma).trim() : line;
    const entryName = comma > 0 ? line.slice(comma + 1).trim() : line;
    items.push({ file, entryName: entryName.toUpperCase() });
  }
  return { podFilename, volumeName, items };
}

/**
 * Relative paths to try for a list item, in order: next to the list, then its parent folder.
 * `listFolder` is the list's folder relative to the picked root ("" when the list is at the root).
 */
export function resolveCandidates(listFolder, file) {
  const clean = (p) => p.replace(/\\/g, "/").replace(/^\/+/, "");
  const name = clean(file);
  const folder = clean(listFolder ?? "").replace(/\/+$/, "");
  const out = [folder ? `${folder}/${name}` : name];
  if (folder) {
    const up = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
    out.push(up ? `${up}/${name}` : name);
  }
  return out;
}
