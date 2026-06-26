# BIN Parser Bug: `0x0A` Color Block Must Not Clear the Active Texture

> **TL;DR** — In the MTM/MTM2 `.BIN` model format, block token `0x0A` is a
> **face-color block** that sets the solid color for the flat `0x19`
> (`FT_IGNORE_TEX`) faces that follow it. It does **not** end or clear the
> currently-active texture. If your parser resets the "current texture" state
> when it sees `0x0A`, every textured face that appears *after* a `0x0A` block
> loses its texture and renders flat/untextured.

This document is language-agnostic (Java / C++ / JS). It describes the symptom,
the root cause, how to confirm it, and the one-line fix.

---

## Symptom

A model loads with the **correct geometry** but is **partially untextured**:

- The faces near the *start* of the model are textured correctly.
- From some point onward, a large contiguous chunk of the model renders with
  the flat/default material color (gray) instead of its texture.
- Model stats show the mesh split into a textured group **and** an unexpected
  untextured group, even though the file only declares one texture.

Reference case: `LOADER.BIN` (MTM2 wheel loader, `art/LOADER.RAW`,
`art/LOADER.ACT`). Correct rendering = fully textured yellow loader. Buggy
rendering = textured cab/engine but gray bucket, arm, and front wheels.

The reason it looks like a *spatial* split is that BIN faces are usually stored
in groups; the `0x0A` block happens to sit partway through the face list, so
everything authored after it goes gray.

---

## BIN block stream background

A `.BIN` model is a header (magnify power, base Z), a vertex array, then a flat
stream of variable-length **blocks**, each introduced by a 4-byte little-endian
token. The parser keeps a small amount of running state while walking the
stream — most importantly, the **currently-active texture**:

| Token  | Meaning                                                            | Effect on active texture |
|--------|-------------------------------------------------------------------|--------------------------|
| `0x0D` | Texture block — declares a still texture name (e.g. `LOADER.RAW`) | **Sets** active texture  |
| `0x1D` | Animated-texture block                                            | **Sets** active texture  |
| `0x0A` | **Face-color block** — a `COLORREF` for following flat faces      | **None** (color only)    |
| `0x18` | Normal textured face (has per-vertex UVs)                         | Uses active texture      |
| `0x29` / `0x11` / `0x33` / `0x0E` | Shiny / transparent / hellbender mapped faces  | Uses active texture      |
| `0x19` | `FT_IGNORE_TEX` — flat, solid-color face (no texture, no UVs)     | Uses the `0x0A` color    |
| `0x00` | End of model                                                      | —                        |

Mapped faces (`0x18`, `0x29`, …) carry per-vertex `(index, U, V)` triples and
paint with the active texture. Flat faces (`0x19`) carry only vertex indices
(no UVs) and paint with a **solid color** — the color most recently supplied by
a `0x0A` block.

### What `0x0A` actually is

`0x0A` precedes one or more `0x19` flat faces and supplies their fill color:

```
token  0x0000000A
DWORD  color        // COLORREF, low 24 bits = RGB
```

It is **only** a color register. It does not start a new material group, does
not end the previous texture, and does not affect subsequent *mapped* faces.
The active texture set by the last `0x0D`/`0x1D` stays in effect until the next
`0x0D`/`0x1D` (or end of model).

---

## Root cause

The buggy parser treats `0x0A` as if it were a "material boundary" or "end of
texture" marker and clears the active-texture state:

```js
// WRONG — clears the active texture
case 0x0000000A:
  skip(4);                 // read the color DWORD
  currentTexture = "";     // ❌ side effect that should not be here
  break;
```

Consequence: the `0x0A` block typically sits **in the middle** of the face
list (right before a couple of flat `0x19` faces). After it, the parser still
encounters many ordinary `0x18` textured faces — but `currentTexture` is now
empty, so those faces are bucketed as untextured and rendered with the default
flat color.

In the `LOADER.BIN` case: 42 textured faces appear before the `0x0A`, then
2 flat `0x19` faces, then ~207 more `0x18` textured faces. The bug stripped the
texture from those 207 faces → the large gray region.

---

## The fix

`0x0A` must consume its 4-byte color payload and **leave the active texture
untouched**. (If your renderer supports per-face solid colors, store the color
for the upcoming `0x19` faces; if it doesn't, simply skip the 4 bytes.)

```js
// CORRECT
case 0x0000000A:
  // Face-color block (COLORREF) for the flat 0x19 (FT_IGNORE_TEX) faces that
  // follow. Color only — must NOT clear the active texture, which stays in
  // effect for later mapped faces.
  skip(4);
  break;
```

Only `0x0D` and `0x1D` may change the active texture.

### Reference implementation (matches BinEdit `CBINModel::ReadModel`)

```text
on 0x0D:  read name; activeTexture = lookup(name)        # sets texture
on 0x1D:  read anim;  activeTexture = lookup(anim)        # sets texture
on 0x0A:  faceColor = readColor()                         # color ONLY
on 0x19:  face.texture = NONE; face.color = faceColor     # flat face
on 0x18 / 0x29 / 0x11 / 0x33 / 0x0E:
          face.texture = activeTexture; read UVs          # mapped face
```

Note that BinEdit resets `faceColor` to the default at each `0x0D` and never
touches the texture pointer inside the `0x0A` handler — that is the behavior to
mirror.

---

## How to confirm it on your own parser

1. **Find a model with a mid-stream `0x0A`.** Walk the block stream and log
   each token with the running `currentTexture` and face count. A model is a
   good test case if a `0x0A` appears with textured faces *both before and
   after* it. (`LOADER.BIN` is the canonical example.)
2. **Check the mesh grouping.** Before the fix you get two groups for a
   single-texture model: one textured, one empty-named. After the fix you get
   a single textured group covering all mapped faces.
3. **Visual check.** The previously-gray region becomes textured and matches a
   known-good viewer (e.g. BinEdit).

Example diagnostic trace from the `LOADER.BIN` repro (token @byte / state):

```
@4532  tok=0x0D  curTex=''            -> sets LOADER.RAW
@...   tok=0x18  curTex='LOADER.RAW'  (x42 textured faces)
@7556  tok=0x0A  curTex='LOADER.RAW'  -> color block
@7564  tok=0x19  curTex=''   <-- BUG: texture was cleared here
@7600  tok=0x19  curTex=''
@7636  tok=0x18  curTex=''   <-- textured face now renders gray
...    (x205 more 0x18 faces, all gray)
```

After the fix, `curTex` stays `'LOADER.RAW'` from the first `0x0D` to end of
model, and all `0x18` faces are textured.

---

## Per-language notes

- **JS** (this repo): single edit in
  [`src/worker/bin-decoder.js`](../src/worker/bin-decoder.js) — remove the
  `currentTexture = ""` assignment from the `0x0A` case.
- **Java**: in your block `switch`, the `0x0A` case should read 4 bytes (the
  color) and **not** assign `null`/`""` to the active-texture field. If you
  model faces with a color, store it for the next `0x19` faces.
- **C++** (reference: BinEdit `CBINModel::ReadModel`,
  `source/BINModel.cpp`): the `0x0A` case reads a `COLORREF` into `color` and
  leaves `tex` unchanged; flat `0x19` faces get `m_pTexture = NULL` and
  `m_Color = color`, mapped faces get `m_pTexture = tex`.

---

## Related correctness note (optional)

Flat `0x19` (`FT_IGNORE_TEX`) faces have **no UV data** and are meant to render
with the solid `0x0A` color, not a texture. If your parser assigns the active
texture name to `0x19` faces, they will sample a single texel (UV `0,0`) instead
of showing a flat color. This is cosmetic and usually minor, but to match
BinEdit exactly, give `0x19` faces no texture and use the `0x0A` color. This is
independent of — and secondary to — the main bug above.
