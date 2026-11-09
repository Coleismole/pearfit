// Derives a candidate's garment type from its product name. Kept outside src/ with the other I/O-side code.
//
// The category stored in commercial_skus is not used: it is wrong too often to trust (tees stored as
// "Trousers" or "Fleece & Hoodies", blouses and blousons stored as "T-Shirts & Tops"). The name is.
import type { GarmentType } from "../src/types.ts";

const JACKET = /\b(jacket|parka|coat|blouson)\b/i;
const DOWN = /\bdown\b/i; // a jacket, unless the name is a shirt ("Button-Down", or the typo "Botton Down")
const POLO = /\bpolo\b/i;
const KNITWEAR = /\b(sweater|cardigan|pullover|sweatshirt|hoodie|jumper)\b/i; // "Polo Sweater" is not a polo
const TEE = /\bt[- ]?shirt\b|\btee\b/i;
const LONG_SLEEVE = /\blong[- ]sleeves?\b/i;
const SHIRT = /\bshirt\b/i;
const BUTTON_SHIRT = /\b(oxford|flannel|chambray|button[- ]?(up|down|front))\b/i;
const NOT_A_TEE = /\b(sweater|sweatshirt|hoodie|pullover|cardigan|knit(ted)?|fleece|jumper)\b/i;
const CREW = /\bcrew\b/i;

export function garmentTypeFor(productName: string): GarmentType {
  const name = productName;
  if (JACKET.test(name) || (DOWN.test(name) && !SHIRT.test(name))) return "jacket";
  if (POLO.test(name) && !KNITWEAR.test(name)) return "polo";
  if (TEE.test(name)) return teeOrLongSleeve(name);
  if (BUTTON_SHIRT.test(name) || SHIRT.test(name)) return "button_shirt";
  // A bare "Crew" (e.g. "Midweight Crew in Natural") is a tee, unless the name says it is a sweater or similar.
  if (CREW.test(name) && !NOT_A_TEE.test(name)) return teeOrLongSleeve(name);
  return "other";
}

function teeOrLongSleeve(name: string): GarmentType {
  return LONG_SLEEVE.test(name) ? "tee_long_sleeve" : "tee";
}
