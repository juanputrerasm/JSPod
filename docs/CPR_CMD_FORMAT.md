# CART Precision Racing CMD model format

`.CMD` is CART Precision Racing's text-based high-detail vehicle model. A CPR
`.CAR` manifest names the CMD and a separate low-detail `.BIN`; the CMD itself
contains the detailed body as individually positioned parts.

## Header

The file begins with label/value line pairs:

```text
name
<display name>
lowDetailName
<BIN filename>
lowDetailCenterZ
<integer offset>
material
<RAW texture filename>
```

The texture is a paletted `.RAW` image. Its same-stem `.ACT` supplies the
palette when present.

## Parts

Part records repeat to the end of the file:

```text
partName
<name>
vertexCount
<count>
faceCount
<count>
center
<x,y,z>
angle
<x,y,z>
vertexList
<vertexCount x,y,z lines>
normalList
<vertexCount x,y,z lines>
faceList
<face records>
```

Each face record contains a `type,cornerCount` line, a four-value plane line,
and then `cornerCount` lines of `vertexIndex,u,v`. Stock vehicle faces use type
`0x29` (decimal 41) and have three or four corners.

## Numeric scales and axes

- Positions and part centers use 8-bit fixed point: divide by `256`.
- Normals use 16-bit fixed point: divide by `65536`, then normalize.
- Texture coordinates divide by `0xff0000`; V is top-down.
- Native axes are X lateral, Y up, and Z forward.
- `lowDetailCenterZ` is added to the native Z coordinate when positioning the
  high-detail model against its low-detail counterpart.

## Alternate aero packages

Stock cars contain both road/street-course and speedway/oval parts in one CMD.
The unsuffixed `LFWING`, `RFWING`, and `RWING` parts form the road package. The
`LFWING1`, `RFWING1`, `RWING1`, and `SPDFIN` parts form the speedway package.
Only one package should be rendered at a time; otherwise coincident parts cause
z-fighting.

Part rotation values in the stock vehicle set are zero. The convention for
non-zero `angle` values is not yet established.
