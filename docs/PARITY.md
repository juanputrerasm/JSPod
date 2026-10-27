# KPod parity

JSPod 2.0 follows the feature set of KPod 2.0.1, the desktop POD editor (`KPod.Windows/UI/MainForm.cs`). This page maps each KPod feature to where JSPod implements it, lists the deliberate differences, and ends with a manual test checklist adapted from KPod's `MANUAL-CHECKLIST.md`.

File formats are not implemented in either app's UI code. KPod has its own readers and writers; JSPod uses OpenPhotex 1.4, which added a POD2 writer for this work. OpenPhotex rebuilds every stock POD1 directory and all 59 4x4 Evolution POD2 archives in the local install byte for byte.

## Feature map

| KPod | JSPod | Where |
|---|---|---|
| Open `.pod`/`.epd`; only the directory is read | File > Open, drag and drop, Open from URL, `?url=`. The archive is staged in OPFS and entries are read on demand | `src/pod-app.js` (`openFileNow`), `src/worker/pod-format.js` |
| Read POD1, POD2, EPD | Same, plus the first POD in a ZIP | OpenPhotex `parsePod` |
| Write POD1 (default) and POD2 | Same. Save keeps the archive's format; Save As and the "Save as" box choose | `src/worker/pod-writer.js`, OpenPhotex `buildPod1Directory`, `buildPod2Directory` |
| POD2 CRC-32/MPEG-2 per entry and archive | Same, computed while streaming | OpenPhotex `crc32Mpeg2Update` |
| POD2 to POD1 warns that timestamps and audit history are lost | Same, in Save As and the "Save as" box | `saveAs`, `changeOutputFormat` |
| New Archive | File > New Archive | `newArchive` |
| Open Response List (`.lst`/`.rsp`) | File > Open Response List: pick the folder; the list's own folder is searched, then its parent | `src/model/response-list.js` |
| Save (temp file, then swap) | Writes into OPFS, then to the file (the browser's writable stream commits on close) or a download | `saveTo` |
| Save reopens the written file | Same | `saveTo` |
| Unsaved changes prompt on open, new, recent, close | Same, plus the browser's leave-page prompt | `confirmDiscard` |
| Add Files (timestamp from the file's modification time) | Same; adds into the selected folder, or the root | `addFiles` |
| Add Folder (keeps the folder name) | Same | `addFolderPicker`, `src/app/disk.js` |
| Create Folder | Same | `src/model/edits.js` `createFolder` |
| Remove (a folder removes its subtree) | Same | `removeEntries` |
| Replace with File (keeps name and palette record) | Same | `replaceEntry` |
| Rename file or folder | Same | `renameEntry`, `renameFolder` |
| Move To Folder; a folder cannot move into itself | Same | `moveEntries` |
| Drag rows onto a folder to move them | Same; onto a file means its folder, onto empty space means the root | `src/ui/entry-list.js` |
| Drop desktop files on the list to add them | Same, folders included | `dropFiles` |
| Disable / Enable in Game (`.TRK`/`.SIT`/`.SI2` to `.TRX`/`.SIX`/`.SIY`, case kept) | Same | `src/model/disable.js` |
| Extract Selected / Extract All, keep folder structure | Same | `extract` |
| Comment, 79 bytes, original bytes kept when unchanged | Same | `commitComment`, `PodDocument.commentForWrite` |
| POD2 audit trail: record on/off, author, history table; rename/move = remove + add | Same | `src/model/edits.js`, `src/app/tools.js` |
| Validate (paths, duplicates, palette records, CRCs, overlaps, name budget, comment, entry count) | Same | `src/model/validate.js`, `tools.validate` |
| Tree list with Name, Size, Description; folders first; three-step sort; quick filter over collapsed folders | Same | `src/model/browser.js`, `src/ui/entry-list.js` |
| Advanced search: names, sizes, match case, next/previous with wrap, jump to | Find panel | `src/ui/search-panel.js` |
| Status bar: projected size, count, selected, unsaved | Footer | `renderFooter` |
| RAW/CLR preview, palette picker, dimension dialog, Save as BMP | Same, plus Save as PNG | `src/preview/raw-preview.js` |
| ACT grid with hover | Same | `src/preview/act-preview.js` |
| TGA, PNG, BMP, JPG, GIF previews | Same | `tga-preview.js`, `image-preview.js` |
| TIF (KPod falls back to hex) | Evo palette TIFFs decode | `tiff-preview.js` |
| OPA (KPod shows hex) | Greyscale opacity view | `opa-preview.js` |
| Text view | Text view with an editor | `text-preview.js` |
| Hex dump of the first 4 KB | Paged through the whole entry | `hex-preview.js` |
| WAV player | `<audio>` with play, pause, seek, time | `wav-preview.js` |
| MOD via an optional libopenmpt add-on | Built in (OpenPhotex `renderMod`) | `mod-preview.js` |
| 3D viewer: textures, wireframe, grid, smoothing, lighting, stats, texture strip, animated BIN (A key) | Same, plus SMF, CMD, DFM, KFM | `bin-preview.js` |
| Save .inf report, Save .lst list | Same | `src/model/reports.js` |
| Mount in pod.ini (no duplicates, warn at 99, through `pod.wrk`, CRLF) | Same (Chromium) | `src/model/pod-ini.js`, `tools.mountInPodIni` |
| Recent files (10) | File > Open Recent (Chromium) | `src/app/disk.js` |
| Keyboard: Enter, A, arrows | Same, plus Ctrl+O/S/Z/Y/F/A, Delete, F2, Shift/Ctrl selection | `globalKey`, `EntryList.onKeyDown` |

## Beyond KPod

- Undo and redo for every edit (`src/model/history.js`).
- Text entries edited in place, written back as windows-1252 with the entry's own line ends.
- Import Image as RAW: PNG, BMP, JPG, GIF, WebP or TGA to `.RAW` with its own `.ACT` (`encodeRawTexture`) or onto an existing palette (`quantizeToPalette`).
- Save as PNG for image previews.
- Edits are validated as they are made, not only at save time.

## Deliberate differences

- **Duplicate names.** KPod saves an archive that arrived with duplicate names. OpenPhotex refuses to write duplicates, so JSPod lets such an archive be edited but asks for the duplicates to be fixed before saving.
- **pod.ini lookup.** KPod tries the archive's folder, then its parent. A browser can only see the folder the user picks, so JSPod asks for the folder that holds `pod.ini`.
- **Response lists.** A browser cannot resolve paths on disk, so JSPod asks for the folder holding the list (or its parent) and searches inside it.
- **Add Files target.** KPod adds to the root. JSPod adds into the selected folder when one is selected.
- **Empty folders.** As in KPod, a folder created and left empty is not saved, because POD archives store no folders.
- **Undo after save.** The history resets on save, because the saved archive replaces the working copy.
- **Chromium-only features.** Save in place, the Save As picker, Open Recent, extracting into a folder and Mount in pod.ini need the File System Access API. Firefox and Safari download instead.

## Manual test checklist

Have on hand: a classic POD1 with subfolders (an MTM track pack), a large one (Hellbender `GAME.POD`, 4,000+ entries), a POD2 (4x4 Evo), an EPD (Fly!), and a ZIP holding a POD. Run in Chrome, then repeat the marked items in Firefox or Safari. Serve the folder (`python3 -m http.server 8080`) and open <http://localhost:8080/>.

### Opening and browsing
- [ ] File > Open opens a POD1; the bar shows the name and "Read as POD1", the footer the entry count.
- [ ] A POD2 reads "Read as POD2", an EPD "Read as EPD" (with "Save as POD1"), a ZIP opens its POD.
- [ ] Dropping a POD on the page opens it. *(Firefox/Safari too)*
- [ ] `?url=` autoloads an archive.
- [ ] Folders start collapsed and sit above loose files; nested folders indent.
- [ ] Double-click, Enter or the arrow opens and closes a folder; Left/Right close and open it.
- [ ] Expand all / Collapse all work.
- [ ] `GAME.POD` scrolls smoothly with no blank rows.
- [ ] The comment box shows the archive comment.
- [ ] For a freshly opened POD1 or POD2, the footer size equals the file size on disk.

### Sorting, filtering, selection
- [ ] Name, Size and Description each cycle ascending, descending, archive order, with an arrow on the sorted column.
- [ ] Folders stay above files under every sort.
- [ ] The filter narrows as you type, reveals matches in collapsed folders, and clearing it restores the collapse state.
- [ ] Filtering on a folder name keeps its subtree.
- [ ] Ctrl/Cmd-click and Shift-click extend the selection; a selected folder counts every entry under it in the footer.
- [ ] The selection survives expanding, collapsing, sorting and filtering.

### Preview
- [ ] RAW: palette dropdown, dimension dialog for odd sizes, Save as BMP and Save as PNG with the chosen palette.
- [ ] CLR shows like RAW; OPA shows greyscale; TIF (Evo 2) and TGA decode; PNG transparency shows.
- [ ] ACT grid shows index and colour on hover.
- [ ] Text entries show; unknown binaries show hex, paged with the arrows, and the offset box jumps.
- [ ] WAV plays with seek and time; a `.MOD` renders and plays.
- [ ] BIN, SMF, CMD, DFM, KFM open in the 3D viewer with every toggle working; A steps animated BIN frames.

### Editing *(Firefox/Safari too)*
- [ ] Add Files appends the files (into the selected folder if one is selected) and the status line reports the count.
- [ ] Adding an existing name offers Replace / Skip.
- [ ] Add Folder keeps the folder's own name; dropping a desktop folder on a folder row adds it inside.
- [ ] Create Folder adds an empty folder; it disappears after saving if still empty.
- [ ] Replace with File keeps the name; Rename (F2) renames a file or a whole folder.
- [ ] Renaming to an existing name, or to a POD1 name over 31 bytes, is refused with the reason.
- [ ] Move To Folder and dragging rows onto a folder move them; moving a folder into itself is refused.
- [ ] Remove (Delete) removes the selection; a folder removes its subtree.
- [ ] Disable in Game renames `.TRK`/`.SIT`/`.SI2` to `.TRX`/`.SIX`/`.SIY` keeping case; Enable reverses it.
- [ ] Editing the comment marks the archive unsaved; 80 bytes or a character like 雪 is refused.
- [ ] Every edit above undoes and redoes (Ctrl/Cmd+Z, Ctrl+Y or Cmd+Shift+Z), and undoing back to the opened state clears the unsaved marker.
- [ ] Text entry: Edit, change, Apply; the preview shows the new text, the entry is marked unsaved, and undo restores it. A character outside windows-1252 is refused with its line.
- [ ] Import Image as RAW: a square PNG with "Own palette" adds `NAME.RAW` and `NAME.ACT` that preview correctly; "Existing palette" maps onto an archive `.ACT` or a stock METALCR2; a non-square image only allows an existing palette.

### Saving
- [ ] Save on an opened POD1 confirms, writes the file in place (Chromium), and reopens it; the unsaved marker clears.
- [ ] Opening that file in KPod or JPod shows the same entries; an unchanged save is byte-identical to the original.
- [ ] Save As offers POD1 and POD2 only; converting a POD2 to POD1 warns first.
- [ ] Save As in Firefox/Safari asks for a name, appends `.pod` when it has none, and downloads.
- [ ] A POD2 saved by JSPod passes `openphotex pod verify` and loads in 4x4 Evolution.
- [ ] A POD1 saved by JSPod loads in the game (for example an MTM2 track pack).
- [ ] Saving an archive with a name too long for POD1 fails with a message naming the entry.
- [ ] An EPD saved as POD2 reopens with the same entries.

### Extraction
- [ ] Extract All (Chromium) recreates the folder structure in the picked folder.
- [ ] Extract Selected with "Keep folder structure" off writes flat files.
- [ ] Firefox/Safari: one entry downloads directly; several download as a ZIP.

### Tools
- [ ] Validate on an unchanged POD2 reports every CRC matching; on an edited archive it reports what Save would refuse.
- [ ] POD2 audit history lists the existing records plus new "unsaved" ones after edits; turning recording off stops new ones; Set Audit Author changes the user written.
- [ ] Save .inf Report: header lines, blank line, column header, then name / size at column 30 / offset at column 45; no byte-order mark; CRLF line ends. A name wider than 30 characters pushes the columns right.
- [ ] Save .lst List writes one name per line, and Open Response List reads it back.
- [ ] Before saving, the reports ask for a save first.

### Response lists
- [ ] Open Response List builds an archive from a `.lst`, marks it unsaved, and reports the entry count.
- [ ] `file,ARCHIVE\NAME` stores the entry under the second name; `podFilename:` and `volumeName:` set the name and comment.
- [ ] A list naming a missing file reports which one.

### pod.ini (Chromium)
- [ ] Mount in pod.ini adds the line and increments the count; no `pod.wrk` is left behind.
- [ ] Mounting the same POD twice reports "POD already mounted".
- [ ] A folder without `pod.ini` is reported.
- [ ] Mounting into a list of 99 warns but mounts.
- [ ] Firefox/Safari explain that mounting needs Chrome or Edge.

### Recent files and unsaved changes
- [ ] File > Open Recent lists archives opened with File > Open, newest first, at most ten, surviving a reload (Chromium).
- [ ] A recent file that was moved or deleted is reported and removed from the list.
- [ ] With unsaved edits, Open, New Archive, Open Recent, Open Response List, Close and leaving the page all ask first; cancelling keeps the edits.

### Keyboard and layout
- [ ] Ctrl/Cmd+O, S, Shift+S, Z, Y, F, A, Delete, F2 and Enter do what Help > Keyboard Shortcuts lists, and none fire while typing in a text box.
- [ ] The splitter resizes the list and the width is remembered.
- [ ] At phone width the list sits above the preview and nothing scrolls sideways.
