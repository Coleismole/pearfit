// A soft colour block with a shirt outline. The API has no product photos, so this stands in for one.
import { ShirtIcon } from "./Icons.tsx";
import type { ReactNode } from "react";

// The swatch colours used in the design.
const COLOURS = ["#DCE6EF", "#EFE6D8", "#E4E0D2", "#D6DEE8", "#E2ECE0", "#EAE3D6", "#DDE3E0", "#EDE9DA", "#E3E6EE", "#E7DAD6"];

// The same shirt always gets the same colour.
function colourFor(seed: string): string {
  let sum = 0;
  for (const ch of seed) sum = (sum * 31 + ch.codePointAt(0)!) % 9973;
  return COLOURS[sum % COLOURS.length];
}

type Variant = "row" | "match" | "head" | "tile" | "compare" | "hero";
const ICON_SIZE: Record<Variant, number> = { row: 24, match: 28, head: 36, tile: 48, compare: 36, hero: 64 };

export function Thumb({ seed, variant, children }: { seed: string; variant: Variant; children?: ReactNode }) {
  return (
    <span className={`thumb thumb--${variant}`} style={{ background: colourFor(seed) }}>
      <ShirtIcon size={ICON_SIZE[variant]} />
      {children}
    </span>
  );
}
