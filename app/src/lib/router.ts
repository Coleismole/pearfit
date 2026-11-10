// A very small hash router: "#/check/e465187-000/compare?size=M". Hash routes need no server rewrites, so the
// built files work on any static host and under any sub-path.

export interface Route {
  segments: string[]; // ["check", "e465187-000", "compare"]
  query: Record<string, string>; // { size: "M" }
}

export function parseHash(hash: string): Route {
  const text = hash.replace(/^#\/?/, "");
  const cut = text.indexOf("?");
  const path = cut === -1 ? text : text.slice(0, cut);
  const search = cut === -1 ? "" : text.slice(cut + 1);
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) query[key] = value;
  return { segments: path.split("/").filter(Boolean).map(safeDecode), query };
}

// A stray "%" in a hand-edited address must not crash the app.
function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

// link("check", id, "compare", { size: "M" }) -> "#/check/<id>/compare?size=M". Undefined query values are left out.
export function link(...parts: (string | Record<string, string | undefined>)[]): string {
  const segments: string[] = [];
  const params = new URLSearchParams();
  for (const part of parts) {
    if (typeof part === "string") {
      segments.push(encodeURIComponent(part));
    } else {
      for (const [key, value] of Object.entries(part)) if (value !== undefined) params.set(key, value);
    }
  }
  const search = params.toString();
  return `#/${segments.join("/")}${search ? `?${search}` : ""}`;
}
