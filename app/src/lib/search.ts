// Catalog search for the picker. It filters the list from GET /api/candidates in the browser: no extra request.
import type { PickerCandidate } from "./types.ts";

// Lowercase, accents and apostrophes dropped, so "mens airism" finds "Men's AIRism".
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase();
}

function dashed(text: string): string {
  return normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function looksLikeLink(query: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(query.trim());
}

// What was typed can be:
//   - words from the product name, in any order ("airism crew")
//   - a SKU, with or without its dash ("E465187-000", "e465187000")
//   - a product link that has the SKU in it (".../products/E465187-000/00?colorDisplayCode=26")
// An empty query returns the whole catalog. The order of the list is kept.
export function searchCandidates(candidates: readonly PickerCandidate[], query: string): PickerCandidate[] {
  const q = query.trim();
  if (q === "") return [...candidates];

  if (looksLikeLink(q)) {
    // The link is not fetched or parsed. It only matches when a known id sits in it as a whole dash-separated part.
    const link = `-${dashed(q)}-`;
    return candidates.filter((c) => link.includes(`-${c.id}-`));
  }

  const tokens = normalize(q).split(/\s+/).filter(Boolean);
  return candidates.filter((c) => {
    const haystack = `${normalize(c.name)} ${c.id} ${c.id.replace(/-/g, "")}`;
    return tokens.every((t) => haystack.includes(t));
  });
}
