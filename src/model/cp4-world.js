/*
  Which 16-bit DATA\<track>.RAW heightmap a pod entry is, for the preview and the type label.

  The CP4 world sidecars (.WTR lakes, MTM2 .VEG vegetation, beta 0.53 .WFL waterfalls) and the
  height samples themselves are parsed by OpenPhotex (src/vendor/openphotex: parseWtr,
  parseMtm2Veg, parseWfl, decodeMtm2Heights). What stays here is JSPod's own question: is this
  RAW a heightmap at all (only by its size inside a DATA folder), and which games' units can it
  be read in.

  CP4 accepts a u16 little-endian 256x256 (131,072 bytes) or a 1024x1024 at an 8 ft grid
  (2,097,152 bytes), both in 1/128 ft. CART Precision Racing ships 131,072-byte u16 RAWs too, in
  1/16 ft (10.6 fixed point in 4 ft steps), so that size keeps both readings on offer.
*/
import {
  MTM2_H16_PER_FT, MTM2_RAW_LENGTH_16BIT, MTM2_RAW_LENGTH_FINE, MTM2_FINE_CELL_FT,
  CPR_HEIGHT_DIVISOR, CPR_ALTITUDE_DIVISOR,
} from "../vendor/openphotex/index.js";

const CPR_UNITS_PER_FT = CPR_HEIGHT_DIVISOR / CPR_ALTITUDE_DIVISOR;

export const HEIGHTMAP_SCALES = {
  cp4: { label: `CP4 (feet = v / ${MTM2_H16_PER_FT})`, divisor: MTM2_H16_PER_FT },
  cpr: { label: `CPR (feet = v / ${CPR_UNITS_PER_FT})`, divisor: CPR_UNITS_PER_FT },
};

/** { side, gridFeet, interpretations } for a 16-bit heightmap RAW in a DATA folder, else null. */
export function heightmapRawLayout(path, byteLength) {
  const inData = /(^|[\\/])DATA[\\/][^\\/]+\.RAW$/i.test(String(path ?? ""));
  if (!inData) return null;
  if (byteLength === MTM2_RAW_LENGTH_16BIT) return { side: 256, gridFeet: 32, interpretations: ["cp4", "cpr"] };
  if (byteLength === MTM2_RAW_LENGTH_FINE) return { side: 1024, gridFeet: MTM2_FINE_CELL_FT, interpretations: ["cp4"] };
  return null;
}
