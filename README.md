# JSPod

[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-F7DF1E?logo=javascript&logoColor=000)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Three.js](https://img.shields.io/badge/Three.js-r169-000?logo=threedotjs)](https://threejs.org/)
[![Platform](https://img.shields.io/badge/platform-web-blue)](https://developer.mozilla.org/docs/Web)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-222?logo=github)](https://juanputrerasm.github.io/JSPod/)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](LICENSE)

**A browser-based archive explorer and asset viewer for Terminal Reality POD files.**

JSPod opens POD, EPD, and ZIP archives without uploading their contents to a server. It presents the archive as a searchable file tree, previews common game assets, and can extract one file or repack the complete archive as ZIP.

**Live application:** [Open JSPod on GitHub Pages](https://juanputrerasm.github.io/JSPod/)

![JSPod previewing an HD-textured MTM2 BIN model from a POD archive](docs/screenshot.jpg)

---

## Features

- **Local or remote archives** — open files from disk, a URL, or an autoload query parameter.
- **Private client-side processing** — indexing, decoding, and preview generation happen in the browser.
- **Archive navigation** — search and browse a collapsible directory tree with entry metadata.
- **Asset previews** — inspect textures, palettes, 3D models, text, audio, and common web images.
- **Modern MTM2 (Community Patch 3) support** — read extended POD1 directories, long BIN texture names, material records, PNG/TGA textures, and tangent-space normal maps.
- **Extraction** — download a selected entry or export the archive contents as a ZIP.

## Supported archive formats

| Format | Description | Support |
|---|---|---|
| POD1 | Original Terminal Reality POD layout | Read |
| POD1-64 (Extended POD1) | POD1-compatible layout with 64-byte entry names | Read |
| POD2 | POD2 archive layout | Read |
| EPD | Enhanced POD layout | Read |
| ZIP | Loads the first POD contained in the ZIP | Read |

“POD1-64” is not an official new POD version. The archive remains POD1-compatible and widens each directory name field from 32 to 64 bytes.

## Preview support

| File types | Preview |
|---|---|
| `.BIN`, `.LWO` | Interactive Three.js model viewer with orbit controls |
| `.RAW` | Paletted or grayscale texture with automatic dimension detection and ACT palette selection |
| `.ACT` | 256-color palette grid |
| `.PNG`, `.TGA`, `.BMP`, `.JPG`, `.JPEG`, `.GIF`, `.WEBP` | Image preview |
| `.TXT`, `.INI`, `.TRK`, `.SIT`, `.LVL`, `.DEF`, and other text formats | Text preview |
| `.WAV` | Audio player |

The BIN viewer understands classic and modern MTM2 records, including long texture names, material assignments, reflection and color blocks, and material parameters. For diffuse textures it resolves `.PNG`, then `.TGA`, then `.RAW`; `_N` normal maps use DirectX/green-down tangent space. Their RGB channels are decoded as X/Y/Z, alpha is ignored, and the engine has no roughness texture channel.

In the interactive BIN preview, use the Left and Right Arrow keys to strafe the camera.

## Requirements

- A modern browser with JavaScript modules, Web Workers, WebGL, and Origin Private File System support
- An HTTP or HTTPS origin; browsers do not provide the required features when opened through `file://`
- Network access to the Three.js and fflate CDN modules

## Getting started

### Use the hosted application

1. Open [JSPod on GitHub Pages](https://juanputrerasm.github.io/JSPod/).
2. Choose **Open POD / EPD / ZIP**, or paste an archive URL and choose **Open from URL**.
3. Select an entry in the file tree to preview or download it.

> [!NOTE]
> Remote archives must be served over HTTP or HTTPS. Cross-origin servers must also allow the browser request through CORS.

### Run locally

Clone the repository and serve its root directory with any static HTTP server:

```bash
git clone https://github.com/juanputrerasm/JSPod.git
cd JSPod
python3 -m http.server 8080
```

Then open <http://localhost:8080/>. There is no build step and no package installation.

## URL integration

JSPod can automatically load an archive supplied through either `url` or `file`:

```text
https://juanputrerasm.github.io/JSPod/?url=https%3A%2F%2Fexample.com%2Fgame.pod
https://juanputrerasm.github.io/JSPod/?file=%2Fdownloads%2Fgame.zip
```

Relative archive paths are resolved against the viewer page. When both parameters are present, `url` takes precedence.

## Architecture

| Component | Role |
|---|---|
| ES modules | Application, preview, and user-interface code |
| Module Web Worker | POD indexing, entry reads, and asset decoding off the main thread |
| OPFS | Temporary per-session archive storage |
| Three.js r169 | BIN/LWO rendering and camera controls |
| fflate 0.8.2 | ZIP import and export |

```text
src/
├── pod-app.js              Application controller
├── preview/                File-type preview modules
├── shared/                 Shared OPFS helpers
├── ui/                     File tree and dialog components
├── worker/                 Archive, BIN, texture, and image decoders
├── file-type-info.js       Extension metadata and preview routing
└── zip-utils.js            ZIP archive handling
```

## Known limitations

- JSPod is an archive viewer and extractor; it does not edit or rebuild POD files.
- ZIP input opens the first POD member rather than merging multiple archives.
- Browser image decoding availability depends on the browser's worker APIs.
- Rendering approximates the updated MTM2 material behavior in Three.js; it is not an exact copy of the game renderer.

## Related projects

- [JSTruckViewer](https://github.com/juanputrerasm/JSTruckViewer) — assembles and displays complete MTM2 trucks from TRK and POD data.
- [KPodman](https://github.com/juanputrerasm/KPodman) — desktop POD archive manager.

## Format documentation

- [POD1-64 / Extended POD1](docs/POD1_64_FORMAT.md)
- [BIN HD / Extended BIN](docs/BIN_HD_FORMAT.md)

## Credits and license

Developed by **Juan Pablo Utreras** for the Monster Truck Madness community.

Released under the [Apache License 2.0](LICENSE).

Monster Truck Madness and Terminal Reality are trademarks of their respective owners. This project is an independent community tool and is not affiliated with or endorsed by them.
