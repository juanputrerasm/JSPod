// Extension → { description, icon } mapping for Terminal Reality / related game formats.
// Icons are Unicode characters rendered as text.

const FILE_TYPES = {
  // Palettes / images
  ACT:  { description: "VGA palette",                icon: "🎨" },
  BMP:  { description: "Bitmap image",               icon: "🖼" },
  GIF:  { description: "GIF image",                  icon: "🖼" },
  JPG:  { description: "JPEG image",                 icon: "🖼" },
  JPEG: { description: "JPEG image",                 icon: "🖼" },
  PNG:  { description: "PNG image",                  icon: "🖼" },
  TGA:  { description: "Targa image",                icon: "🖼" },
  WEBP: { description: "WebP image",                 icon: "🖼" },
  TXP:  { description: "Texture palette",            icon: "🎨" },
  TIF:  { description: "TIFF image",                 icon: "🖼" },
  TIFF: { description: "TIFF image",                 icon: "🖼" },
  OPA:  { description: "Opacity plane",              icon: "🖼" },

  // Raw / paletted images
  RAW:  { description: "RAW image data",             icon: "🖼" },

  // Terrain / heightmap
  CLR:  { description: "Terrain texture grid",  icon: "📄" },
  CL0:  { description: "Ground box face textures layer 0",      icon: "📄" },
  CL1:  { description: "Ground box face textures layer 1",      icon: "📄" },
  CL2:  { description: "Ground box face textures layer 2",      icon: "📄" },
  CL3:  { description: "Ground box face textures layer 3",      icon: "📄" },
  CL4:  { description: "Ground box face textures layer 4",      icon: "📄" },
  CL5:  { description: "Ground box face textures layer 5",      icon: "📄" },
  RA0:  { description: "Ground box height layer 0", icon: "📄" },
  RA1:  { description: "Ground box height layer 1", icon: "📄" },
  RA2:  { description: "Ground box height layer 2", icon: "📄" },
  RA3:  { description: "Ground box height layer 3", icon: "📄" },
  RA4:  { description: "Ground box height layer 4", icon: "📄" },
  RA5:  { description: "Ground box height layer 5", icon: "📄" },
  LTE:  { description: "Terrain lighting grid/Fog grid",      icon: "📄" },
  GRM:  { description: "Terrain geometry data",      icon: "📄" },
  TTX:  { description: "Track texture types and grip depth",        icon: "📄" },
  FOG:  { description: "Fog density/color index",        icon: "📄" },
  MAP:  { description: "Map palette data",           icon: "📄" },

  // 3D models
  BIN:  { description: "3D model (BIN mesh)",        icon: "📦" },
  LWO:  { description: "LightWave 3D object",        icon: "📦" },
  SMF:  { description: "3D model (4x4 Evo C3DModel)", icon: "📦" },
  ANI:  { description: "Animated texture table",             icon: "📄" },
  CMD:  { description: "CPR car data",             icon: "📄" },

  // Audio
  WAV:  { description: "Wave audio",                 icon: "🔊" },
  MOD:  { description: "Module audio (MOD)",         icon: "🎵" },
  MIX:  { description: "MIX file",             icon: "📄" },
  KLP:  { description: "Audio clip data",            icon: "📄" },

  // Game data / track format
  SIT:  { description: "Situation (track definition)", icon: "🗺" },
  VEG:  { description: "4x4 Evo vegetation placement", icon: "🌲" },
  WAT:  { description: "4x4 Evo water material",     icon: "💧" },
  SDW:  { description: "4x4 Evo shadow overlay grid", icon: "📄" },
  RTD:  { description: "4x4 Evo terrain auxiliary grid", icon: "📄" },
  SI2:  { description: "Situation, CommPatch 3+ engine", icon: "🗺" },
  SIX:  { description: "Situation, disabled",        icon: "🗺" },
  SIY:  { description: "Situation, CommPatch 3+ engine, disabled", icon: "🗺" },
  TXV:  { description: "Track version manifest",     icon: "📋" },
  LVL:  { description: "Level definition file",                       icon: "🗺" },
  TRK:  { description: "Truck definition file",             icon: "🛻" },
  TRX:  { description: "Truck definition file, disabled",   icon: "🛻" },
  CAR:  { description: "CPR Vehicle definition file",             icon: "🛻" },
  TRN:  { description: "Terrain/transition data",    icon: "📄" },
  TXX:  { description: "Traxx track file",    icon: "📄" },
  DEF:  { description: "Object placement definition",icon: "📄" },
  LVO:  { description: "Level object data",          icon: "📄" },
  CRS:  { description: "Course segment data",        icon: "📄" },
  TNL:  { description: "Tunnel definition",          icon: "📄" },
  TVI:  { description: "TRI video info",           icon: "📄" },
  MIC:  { description: "MIC file",       icon: "📄" },
  NAV:  { description: "Navigation data",            icon: "📄" },
  NDX:  { description: "Font data",                 icon: "📄" },
  PIT:  { description: "Pit road data",              icon: "📄" },
  DVP:  { description: "Developer/debug data",       icon: "📄" },
  GLT:  { description: "Glow/light table",           icon: "📄" },

  // Configuration / metadata
  INI:  { description: "Configuration file",         icon: "⚙️" },
  CFG:  { description: "Configuration file",         icon: "⚙️" },
  LST:  { description: "File list",       icon: "📋" },
  INF:  { description: "Information file",             icon: "📋" },
  JSON: { description: "JSON data",                  icon: "📋" },
  TXT:  { description: "Text file",                  icon: "📝" },
  TEX:  { description: "Texture list (catalog)",               icon: "📄" },
  LOC:  { description: "Localization file",                  icon: "📝" },
  RGN:  { description: "CPR dialog data",               icon: "📄" },
  CMD:  { description: "CPR car data",               icon: "📄" },
  200: { description: "320x200 cockpit data",               icon: "📄" },
  400: { description: "640x400 cockpit data",               icon: "📄" },
  480: { description: "640x480 cockpit data",               icon: "📄" },
  AAI:  { description: "Anti Alias information",               icon: "📄" },

  // Video / misc
  SMK:  { description: "Smacker video",              icon: "🎬" },
  DMO:  { description: "Demo recording",             icon: "📄" },
  VOX:  { description: "Episode data",           icon: "📄" },
  JSIN: { description: "JSON instrument data",       icon: "📄" },
  TTY:  { description: "Texture data",         icon: "📄" },

  // Archive
  POD:  { description: "POD archive",                icon: "🗜" },
  ZIP:  { description: "ZIP archive",                icon: "🗜" },
};

const DEFAULT_TYPE = { description: "Unknown file", icon: "📄" };

// The derived maps CommPatch 26 resolves beside a texture stem. A texture is looked
// up by stem, so FOO.PNG carries FOO_N, FOO_AO, FOO_DTL and FOO_MASK into a pod with
// it; without the suffix spelled out those read as plain pictures in the entry list.
// Longest first, so a stem is never claimed by a suffix that is only part of its own.
const HD_MAP_ROLES = [
  ["_MASK", "terrain detail mask"],
  ["_DTL",  "terrain detail normal"],
  ["_AO",   "ambient occlusion"],
  ["_N",    "normal map"],
];

const ART_EXTENSIONS = new Set(["RAW", "PNG", "TGA"]);

function extensionOf(filename) {
  return String(filename ?? "").toUpperCase().replace(/.*\./, "");
}

/** The map role a file name's stem declares, or null for a plain texture. */
export function getHdMapRole(filename) {
  const stem = String(filename ?? "")
    .toUpperCase()
    .replace(/.*[\\/]/, "")
    .replace(/\.[^.]*$/, "");
  for (const [suffix, role] of HD_MAP_ROLES) {
    // A bare "_N.PNG" has no stem to be a map of, so the suffix has to be carried.
    if (stem.length > suffix.length && stem.endsWith(suffix)) return role;
  }
  return null;
}

// A description that already ends in a parenthetical gains the role inside it, so a
// RAW keeps one set of brackets rather than two.
function withMapRole(description, filename) {
  const role = getHdMapRole(filename);
  if (!role) return description;
  return description.endsWith(")")
    ? `${description.slice(0, -1)}, ${role})`
    : `${description} (${role})`;
}

export function getFileTypeInfo(filename) {
  const ext = String(filename ?? "")
    .toUpperCase()
    .replace(/.*\./, "");
  return FILE_TYPES[ext] ?? DEFAULT_TYPE;
}

export function getRawDescription(filename, byteLength) {
  const ext = extensionOf(filename);
  // An .OPA is an unheadered byte per pixel like a .RAW, so its side length is worth the
  // same read-out; without it a 65,536-byte opacity plane says nothing about its size.
  const base = (ext === "RAW" || ext === "CLR")
    ? rawSizeDescription(byteLength)
    : ext === "OPA"
      ? rawSizeDescription(byteLength).replace("RAW image data", "Opacity plane")
      : getFileTypeInfo(filename).description;
  return ART_EXTENSIONS.has(ext) ? withMapRole(base, filename) : base;
}

function rawSizeDescription(byteLength) {
  if (byteLength === 4096)  return "RAW image data (64×64)";
  if (byteLength === 65536) return "RAW image data (256×256)";
  const side = Math.round(Math.sqrt(byteLength));
  if (side * side === byteLength) return `RAW image data (${side}×${side})`;
  if (byteLength === 64000)  return "RAW image data (320×200)";
  if (byteLength === 256000) return "RAW image data (640×400)";
  if (byteLength === 307200) return "RAW image data (640×480)";
  // Try to factor into a reasonable aspect ratio
  for (const w of [320, 256, 160, 128, 80, 64]) {
    if (byteLength % w === 0) {
      const h = byteLength / w;
      return `RAW image data (non-standard ${w}×${h})`;
    }
  }
  return "RAW image data (non-standard size)";
}

export function formatFileSize(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
