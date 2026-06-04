# JSPod

A browser-based viewer for **POD archives** used by Terminal Reality games: Monster Truck Madness, Monster Truck Madness 2, Terminal Velocity, Fury3, Hellbender, Nocturne, 4×4 Evo, and others.

All decoding runs client-side. No server, no uploads, no install.

---

## Features

- **Open POD and ZIP files** from disk or via URL (including `?url=` query parameter)
- **Collapsible folder tree** with per-type file icons
- **Format descriptions** for 40+ Terminal Reality file extensions
- **Previews** for the most common file types (see below). Advanced BIN (models) and RAW (textures) preview.
- **Download** individual files or the entire archive as a ZIP
- **Live search** to filter the file tree

---

## Supported Archive Formats

| Format | Games | Access |
|--------|-------|--------|
| **POD1** | MTM1, MTM2, CART Precision Racing, Terminal Velocity, Fury3, Hellbender | Read |
| **POD2** | Nocturne, 4×4 EVO 1 & 2 | Read |
| **EPD** | Fly!, Fly2K | Read |

ZIP files containing a `.POD` are supported — the archive is extracted automatically.

---

## File Previews

| Extension | Preview |
|-----------|---------|
| `.RAW` | Palette-indexed image. Palette resolved from same-name `.ACT` → bundled fallbacks. Palette selector and **Save as BMP** included. |
| `.ACT` | 16×16 colour swatch grid with index and hex on hover. |
| `.BIN` `.LWO` | Interactive 3D model viewer (Three.js, OrbitControls). Shows model stats, texture thumbnails, palette selector and a ground grid. Clicking a texture thumbnail opens its RAW preview. |
| `.WAV` | In-browser audio playback via `<audio>`. |
| `.BMP` `.PNG` `.JPG` `.GIF` `.WEBP` | Standard image preview. |
| `.SIT` `.TRK` `.LVL` `.DEF` `.INI` `.TXT` and more | Monospace text viewer (ISO-8859-1). |
| Everything else | Hex dump (first 4 KiB). |

---

## BIN Model Viewer
The most advanced BIN model viewer is here!

- **Textures** loaded from the `ART/` folder of the same POD archive
- **Palette selection**: Selectable palettes from MTM1, Hellbender, TV/F3, CPR, greyscale and all those included in the POD file. Priority goes to same-name ACT.
- **Stats overlay**: format, vertex count, polygon count, magnify power, base Z, texture list
- **Texture strip**: clickable thumbnails for every RAW texture referenced by the model
- **Wireframe**, **texture smoothing**, **selectable lighting** and **grid** options.
- Correct depth precision via model-scale-calibrated near/far planes

---

## Usage

Serve the folder over HTTP or HTTPS (OPFS requires a secure context):

```bash
python3 -m http.server 8000
# then open http://localhost:8000/JSPod/
```

### URL Parameters

Auto-load an archive on page open:

```
?file=relative/path/to/game.pod
?url=https://example.com/game.pod
```

ZIP files are supported too — the first `.POD` inside is extracted and loaded.

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Rendering | Vanilla ES modules, no bundler |
| 3D models | [Three.js](https://threejs.org/) v0.169 via importmap |
| ZIP extraction | [fflate](https://github.com/101arrowz/fflate) v0.8.2 via CDN |
| Heavy parsing | Web Worker (ES module) |
| Session storage | Origin Private File System (OPFS) |
| Styling | Vanilla CSS, CSS variables, dark theme |

```
src/
├── pod-app.js              Main UI controller
├── worker/
│   ├── pod-format.js       POD1 / POD2 / EPD parser
│   ├── bin-decoder.js      BIN mesh decoder (MTM2-style scaling)
│   └── texture-decoder.js  RAW + ACT palette decoder (6-bit VGA aware)
├── preview/
│   ├── bin-preview.js      Three.js BIN model viewer
│   ├── raw-preview.js      RAW/CLR image + BMP export
│   └── …                   ACT, text, WAV, image, hex previewers
└── ui/
    ├── file-tree.js        Collapsible folder tree
    └── modal.js            Native <dialog> wrapper
```

---

## Related Projects

| Project | Description |
|---------|-------------|
| [JPod](https://github.com/juanputrerasm/jpod) | Java desktop POD manager - the original this is ported from |
| [JSTruckViewer](https://github.com/juanputrerasm/jstruckviewer) | Browser-based MTM2 truck (BIN/TRK) viewer |
| [JSTrackViewer](https://github.com/juanputrerasm/jstrackviewer) | Browser-based MTM2/TV/F3/HB track viewer |

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

> THE MONSTER TRUCK MADNESS GUILD
