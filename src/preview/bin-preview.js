import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let _cleanupPrev = null;

export async function render(container, bytes, { entry, podIndex, workerClient, opfsPodPath, selectEntry }) {
  _cleanupPrev?.();
  _cleanupPrev = null;

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.className = "bin-toolbar";

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = "Reset View";

  const wireLabel = makeToggle("Wireframe");
  const texLabel  = makeToggle("Textures", true);
  const gridLabel = makeToggle("Grid", true);
  const [wireCheck, texCheck, gridCheck] = [wireLabel, texLabel, gridLabel]
    .map((l) => l.querySelector("input"));

  toolbar.append(resetBtn, wireLabel, texLabel, gridLabel);

  // ── Panels ─────────────────────────────────────────────────────────────────
  const viewport  = document.createElement("div");
  viewport.className = "bin-viewport";

  const texViewer = document.createElement("div");
  texViewer.className = "tex-viewer";
  texViewer.hidden = true;

  const warnings = document.createElement("div");
  warnings.className = "bin-warnings";
  warnings.hidden = true;

  container.replaceChildren(toolbar, viewport, texViewer, warnings);

  // ── Decode model (once — reused by scene and texture viewer) ───────────────
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const model = await workerClient.call("decodeBin", {
    bytes: uint8, name: entry.title, origin: "LEGACY"
  });

  if (!model || !model.meshes?.length) {
    viewport.innerHTML = `<p class="preview-error">Format: ${model?.format ?? "UNKNOWN"} — no renderable mesh data.</p>`;
    return;
  }

  // ── Stats overlay ──────────────────────────────────────────────────────────
  const statsEl = document.createElement("div");
  statsEl.className = "bin-stats";
  statsEl.innerHTML = buildStatsHtml(model, entry.title);
  viewport.appendChild(statsEl);

  // ── Load textures (once — shared between Three.js scene and thumbnail strip)
  const { textureMap, missingTextures } = await loadTextures(
    model, podIndex, workerClient, opfsPodPath
  );

  if (missingTextures.length > 0) {
    warnings.hidden = false;
    warnings.innerHTML = `<strong>Missing textures:</strong> ${missingTextures.map(escapeHtml).join(", ")}`;
  }

  // ── Texture thumbnail strip ────────────────────────────────────────────────
  // When selectEntry is available, clicking a thumbnail navigates to the RAW file.
  const onTexClick = selectEntry
    ? (name) => {
        const rawEntry = findArtEntry(podIndex, name, ".RAW");
        if (rawEntry) selectEntry(rawEntry);
      }
    : null;
  buildTextureStrip(texViewer, model.textureNames, textureMap, onTexClick);

  // ── Three.js scene (rebuilt when toggles change) ───────────────────────────
  async function buildScene() {
    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x2a2a2e);
    const camera   = new THREE.PerspectiveCamera(48, 1, 0.1, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(viewport.clientWidth || 480, viewport.clientHeight || 360);
    // Insert canvas before the stats overlay so overlays stay on top.
    viewport.insertBefore(renderer.domElement, viewport.firstChild);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const group = new THREE.Group();
    scene.add(group);

    for (const meshData of model.meshes ?? []) {
      const texData    = textureMap.get((meshData.textureName ?? "").toUpperCase());
      const diffuseMap = (texData && texCheck.checked) ? makeDataTexture(texData) : null;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(swapYZ(meshData.positions), 3));
      geometry.setAttribute("normal",   new THREE.Float32BufferAttribute(swapYZ(meshData.normals),   3));
      if (meshData.uvs?.length) {
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(
          buildDisplayUvs(meshData.uvs, diffuseMap), 2));
      }
      geometry.computeBoundingSphere();

      const material = new THREE.MeshBasicMaterial({
        color:               diffuseMap ? 0xffffff : 0x999999,
        map:                 diffuseMap,
        side:                THREE.BackSide,
        transparent:         !!meshData.transparent,
        alphaTest:           meshData.transparent ? 0.5 : 0,
        depthWrite:          true,
        polygonOffset:       !!meshData.transparent,
        polygonOffsetFactor: meshData.transparent ? -1 : 0,
        polygonOffsetUnits:  meshData.transparent ? -4 : 0,
        wireframe:           wireCheck.checked
      });
      group.add(new THREE.Mesh(geometry, material));
    }

    // Grid at model base
    const box    = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    const grid = new THREE.GridHelper(
      Math.ceil(maxDim * 3),
      Math.max(10, Math.min(40, Math.ceil(maxDim * 2))),
      0x4a4a5a, 0x38383e
    );
    grid.position.set(center.x, box.min.y, center.z);
    scene.add(grid);

    // Calibrate near/far to model scale for clean depth precision
    camera.position.set(center.x, center.y + maxDim * 0.5, center.z + maxDim * 1.5);
    controls.target.copy(center);
    camera.near = maxDim * 0.001;
    camera.far  = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.update();

    let animId;
    const loop = () => { animId = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();

    const ro = new ResizeObserver(() => {
      const w = viewport.clientWidth, h = viewport.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(viewport);

    resetBtn.onclick = () => {
      camera.position.set(center.x, center.y + maxDim * 0.5, center.z + maxDim * 1.5);
      controls.target.copy(center);
      controls.update();
    };
    wireCheck.onchange = () => {
      for (const child of group.children) { if (child.material) child.material.wireframe = wireCheck.checked; }
    };
    gridCheck.onchange = () => { grid.visible = gridCheck.checked; };
    texCheck.onchange  = () => {
      _cleanupPrev?.(); _cleanupPrev = null;
      void buildScene().then((fn) => { _cleanupPrev = fn; });
    };

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.remove();
      renderer.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      for (const child of group.children) {
        child.geometry?.dispose();
        if (child.material?.map) child.material.map.dispose();
        child.material?.dispose();
      }
    };
  }

  _cleanupPrev = await buildScene();
}

// ─── Texture loading ──────────────────────────────────────────────────────────
let _bundledActCache = null;
let _bundledActFetch = null;

async function getBundledMetalcr2() {
  if (_bundledActCache) return _bundledActCache;
  if (!_bundledActFetch) {
    _bundledActFetch = fetch("./assets/palettes/metalcr2.act")
      .then((r) => r.arrayBuffer())
      .then((buf) => { _bundledActCache = new Uint8Array(buf); return _bundledActCache; })
      .catch(() => null);
  }
  return _bundledActFetch;
}

async function loadTextures(model, podIndex, workerClient, opfsPodPath) {
  const textureMap      = new Map();
  const missingTextures = [];

  // Resolve shared fallback palette once for textures with no dedicated ACT.
  // Priority: METALCR2.ACT in archive → VGA.ACT in archive → bundled METALCR2.ACT.
  const metalcr2Entry = podIndex.entries.find((e) => e.title.toUpperCase() === "METALCR2.ACT");
  const vgaActEntry   = !metalcr2Entry
    ? podIndex.entries.find((e) => e.title.toUpperCase() === "VGA.ACT")
    : null;
  let fallbackActBytes = null;
  if (metalcr2Entry) {
    const { bytes } = await workerClient.call("readEntryBytes", { opfsPodPath, entry: metalcr2Entry });
    fallbackActBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  } else if (vgaActEntry) {
    const { bytes } = await workerClient.call("readEntryBytes", { opfsPodPath, entry: vgaActEntry });
    fallbackActBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  } else {
    fallbackActBytes = await getBundledMetalcr2();
  }

  for (const texName of model.textureNames ?? []) {
    const rawEntry = findArtEntry(podIndex, texName, ".RAW");
    if (!rawEntry) { missingTextures.push(texName); continue; }
    try {
      const { bytes: rawBuf } = await workerClient.call("readEntryBytes", { opfsPodPath, entry: rawEntry });
      const rawBytes = rawBuf instanceof Uint8Array ? rawBuf : new Uint8Array(rawBuf);

      // Try same-name ACT first; fall through to METALCR2 if none exists.
      const actEntry = findArtEntry(podIndex, texName, ".ACT");
      let actBytes = null;
      if (actEntry) {
        const { bytes: actBuf } = await workerClient.call("readEntryBytes", { opfsPodPath, entry: actEntry });
        actBytes = actBuf instanceof Uint8Array ? actBuf : new Uint8Array(actBuf);
      } else {
        actBytes = fallbackActBytes;
      }

      const decoded = await workerClient.call("decodeRaw", { rawBytes, actBytes, name: texName });
      if (decoded?.rgba?.length) {
        textureMap.set(texName.toUpperCase(), decoded);
      } else {
        missingTextures.push(texName);
      }
    } catch (err) {
      missingTextures.push(`${texName} (${err.message})`);
    }
  }
  return { textureMap, missingTextures };
}

// ─── Texture thumbnail strip ──────────────────────────────────────────────────
function buildTextureStrip(container, textureNames, textureMap, onSelect) {
  container.innerHTML = "";
  if (!textureNames?.length) { container.hidden = true; return; }

  for (const name of textureNames) {
    const data = textureMap.get(name.toUpperCase());

    const canvas = document.createElement("canvas");
    canvas.width  = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    if (data?.rgba) {
      // Convert decoded RGBA to ImageData and draw scaled to 64×64
      const clampedRgba = data.rgba instanceof Uint8ClampedArray
        ? data.rgba
        : new Uint8ClampedArray(data.rgba.buffer, data.rgba.byteOffset, data.rgba.byteLength);
      const tmp = document.createElement("canvas");
      tmp.width  = data.width;
      tmp.height = data.height;
      tmp.getContext("2d").putImageData(new ImageData(clampedRgba, data.width, data.height), 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, 64, 64);
      canvas.className = "tex-thumb";
    } else {
      // Missing — draw a placeholder
      ctx.fillStyle = "#1a1a1e";
      ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = "#444";
      ctx.strokeRect(0.5, 0.5, 63, 63);
      ctx.fillStyle = "#555";
      ctx.font = "bold 20px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", 32, 32);
      canvas.className = "tex-thumb missing";
    }

    const label = document.createElement("span");
    label.className = "tex-label";
    label.textContent = name;
    label.title = name;

    const item = document.createElement("div");
    item.className = onSelect ? "tex-item tex-item-clickable" : "tex-item";
    if (onSelect) item.addEventListener("click", () => onSelect(name));
    item.append(canvas, label);
    container.appendChild(item);
  }
  container.hidden = false;
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function buildStatsHtml(model, filename) {
  const transparentMeshes = (model.meshes ?? []).filter((m) => m.transparent).length;
  const texturedMeshes    = (model.meshes ?? []).filter((m) => m.textureName).length;
  const rows = [
    ["File",     escapeHtml(filename)],
    ["Format",   escapeHtml(model.format ?? "—")],
    ["Vertices", model.vertexCount ?? "—"],
    ["Polygons", model.polygonCount ?? "—"],
    ["Magnify",  model.magnifyPower ?? "—"],
    ["Base Z",   typeof model.baseZ === "number" ? model.baseZ.toFixed(3) : "—"],
    ["Textures", (model.textureNames ?? []).length],
    ["Meshes",   `${(model.meshes ?? []).length} (${transparentMeshes} transp, ${texturedMeshes} textured)`],
  ];
  return rows.map(([k, v]) =>
    `<div class="bin-stat-row"><span class="bin-stat-key">${k}</span><span class="bin-stat-val">${v}</span></div>`
  ).join("");
}

// ─── Three.js helpers ─────────────────────────────────────────────────────────
function makeDataTexture(texData) {
  const data = new Uint8Array(texData.rgba);
  const tex  = new THREE.DataTexture(data, texData.width, texData.height, THREE.RGBAFormat);
  tex.colorSpace      = THREE.SRGBColorSpace;
  tex.flipY           = true;
  tex.generateMipmaps = false;
  tex.minFilter       = THREE.NearestFilter;
  tex.magFilter       = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate     = true;
  return tex;
}

function swapYZ(arr) {
  if (!arr) return [];
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) {
    out[i]     =  arr[i];
    out[i + 1] =  arr[i + 2];
    out[i + 2] = -arr[i + 1];
  }
  return out;
}

function buildDisplayUvs(sourceUvs, texture) {
  const out = new Float32Array(sourceUvs.length);
  const w   = texture?.image?.width;
  const h   = texture?.image?.height;
  if (!w || !h) {
    for (let i = 0; i < sourceUvs.length; i++) out[i] = clamp01(sourceUvs[i]);
    return out;
  }
  for (let i = 0; i < sourceUvs.length; i += 2) {
    out[i]     = snapUvToTexel(sourceUvs[i],     w);
    out[i + 1] = snapUvToTexel(sourceUvs[i + 1], h);
  }
  return out;
}

function snapUvToTexel(value, size) {
  const c = clamp01(value);
  if (!Number.isFinite(size) || size <= 1) return c;
  const idx = Math.floor(c * (size - 1));
  return Math.min(1 - 0.5 / size, Math.max(0.5 / size, (idx + 0.5) / size));
}

function clamp01(v) {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function makeToggle(label, checked = false) {
  const lbl = document.createElement("label");
  lbl.className = "toggle-label";
  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.checked = checked;
  lbl.appendChild(inp);
  lbl.append(` ${label}`);
  return lbl;
}

function findArtEntry(podIndex, texName, ext) {
  const slashified = texName.replace(/\\/g, "/").trim().toUpperCase();
  const basename   = slashified.includes("/")
    ? slashified.slice(slashified.lastIndexOf("/") + 1) : slashified;
  const stem = basename.includes(".")
    ? basename.slice(0, basename.lastIndexOf(".")) : basename;
  if (!stem) return null;
  const target = stem + ext.toUpperCase();
  for (const path of [`ART/${target}`, `MODELS/${target}`, `DATA/${target}`, `TEXTURES/${target}`, target]) {
    const hit = podIndex.entries.find((e) => e.normalizedName === path);
    if (hit) return hit;
  }
  return podIndex.entries.find((e) => e.title.toUpperCase() === target) ?? null;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
