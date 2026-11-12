// Tests for the API client (src/lib/api.ts). fetch is replaced by a fake, so nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, getCandidates, parseCandidates, parseRecommendResponse, postRecommend } from "../src/lib/api.ts";
import type { OwnedShirt } from "../src/lib/types.ts";

const BASE = "https://www.pearfit.app";

interface Seen {
  url: string;
  init: RequestInit;
}

// A fetch that records the request and answers with `status` and `body` as JSON.
function fakeFetch(status: number, body: unknown, seen: Seen[] = []): typeof fetch {
  return (async (url: string | URL | Request, init: RequestInit = {}) => {
    seen.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

const blueTee: OwnedShirt = { id: "blue-tee", label: "great", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: 63 } };

// The exact answers from engine/test/api.test.ts.
const sized = {
  size: "M",
  confidence: "high",
  matchPercent: 67.6,
  fitsLike: "blue-tee",
  verdict: "Get the M, fits like your blue tee.",
  notes: [],
  garmentType: "tee",
  sizes: [{ size: "M", matchPercent: 67.6, fitsLike: "blue-tee" }],
  similar: [{ shirtId: "blue-tee", matchPercent: 67.6 }],
};
const notSized = {
  size: null,
  confidence: "low",
  matchPercent: null,
  fitsLike: null,
  verdict: "No comparable shirts in your wardrobe. This is a polo, and your wardrobe has none.",
  notes: [],
  garmentType: "polo",
  sizes: [{ size: "M", matchPercent: null, fitsLike: null }],
  similar: [],
};

test("getCandidates sends a plain GET to {base}/api/candidates and returns the list", async () => {
  const seen: Seen[] = [];
  const list = [{ id: "e100-000", name: "Test tee", garmentType: "tee", sizes: { M: { chest_cm: 56, length_cm: 72, sleeve_cm: 63 } } }];
  const got = await getCandidates(BASE, { fetchFn: fakeFetch(200, list, seen) });

  assert.deepEqual(got, list);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://www.pearfit.app/api/candidates");
  assert.equal(seen[0].init.method, "GET");
  assert.equal(seen[0].init.headers, undefined); // no custom header, so the browser sends no CORS preflight
  assert.equal(seen[0].init.body, undefined);
});

test("postRecommend sends { wardrobe, candidateId } as JSON with only a Content-Type header", async () => {
  const seen: Seen[] = [];
  const got = await postRecommend(BASE, { wardrobe: [blueTee], candidateId: "e100-000" }, { fetchFn: fakeFetch(200, sized, seen) });

  assert.deepEqual(got, sized);
  assert.equal(seen[0].url, "https://www.pearfit.app/api/recommend");
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(seen[0].init.headers, { "Content-Type": "application/json" }); // the only header the API's CORS allows
  assert.deepEqual(JSON.parse(seen[0].init.body as string), { wardrobe: [blueTee], candidateId: "e100-000" });
});

test("a 200 answer with size null is a normal result, not an error", async () => {
  const got = await postRecommend(BASE, { wardrobe: [blueTee], candidateId: "e200-000" }, { fetchFn: fakeFetch(200, notSized) });
  assert.deepEqual(got, notSized);
  assert.equal(got.size, null);
  assert.equal(got.verdict, "No comparable shirts in your wardrobe. This is a polo, and your wardrobe has none.");
});

test("an error status becomes an ApiError that carries the API's own message", async () => {
  const cases: [number, unknown, string][] = [
    [404, { error: 'No candidate "nope".' }, 'No candidate "nope".'],
    [400, { error: '"wardrobe" must be a non-empty array of owned shirts.' }, '"wardrobe" must be a non-empty array of owned shirts.'],
    [502, { error: "Could not load candidates: down" }, "Could not load candidates: down"],
    [500, "<html>not json</html>", "The Pearfit API answered with HTTP 500."], // no JSON body: fall back to the status
  ];
  for (const [status, body, message] of cases) {
    await assert.rejects(
      postRecommend(BASE, { wardrobe: [blueTee], candidateId: "nope" }, { fetchFn: fakeFetch(status, body) }),
      (e: unknown) => e instanceof ApiError && e.kind === "http" && e.status === status && e.message === message,
      `status ${status}`,
    );
  }
});

test("a request that never gets an answer becomes a network ApiError", async () => {
  const failing = (async () => {
    throw new TypeError("Failed to fetch"); // what a browser throws when offline or blocked by CORS
  }) as unknown as typeof fetch;
  await assert.rejects(
    getCandidates(BASE, { fetchFn: failing }),
    (e: unknown) => e instanceof ApiError && e.kind === "network" && e.status === null && e.message === "Could not reach the Pearfit API.",
  );
});

test("a cancelled request rethrows the abort and is not reported as a network error", async () => {
  const controller = new AbortController();
  controller.abort();
  const aborting = (async () => {
    throw new DOMException("The operation was aborted.", "AbortError");
  }) as unknown as typeof fetch;
  await assert.rejects(
    getCandidates(BASE, { fetchFn: aborting, signal: controller.signal }),
    (e: unknown) => e instanceof DOMException && e.name === "AbortError",
  );
});

test("parseCandidates keeps null measurements null and turns missing or bad ones into null", () => {
  const parsed = parseCandidates([
    { id: "e400-000", name: "Length only tee", garmentType: "tee", sizes: { M: { chest_cm: null, length_cm: 70, sleeve_cm: null } } },
    { id: "e500-000", name: "Odd chart", garmentType: "tee", sizes: { S: { chest_cm: "50" }, M: null } },
  ]);
  assert.deepEqual(parsed[0].sizes, { M: { chest_cm: null, length_cm: 70, sleeve_cm: null } });
  // "50" is a string and the rest is missing: every value is null, none is guessed
  assert.deepEqual(parsed[1].sizes, {
    S: { chest_cm: null, length_cm: null, sleeve_cm: null },
    M: { chest_cm: null, length_cm: null, sleeve_cm: null },
  });
});

test("parseCandidates keeps the size order and shows an unknown garment type as other", () => {
  const sizes = { XS: {}, S: {}, M: {}, L: {}, XL: {} };
  const [c] = parseCandidates([{ id: "x-1", name: "New kind", garmentType: "hoodie", sizes }]);
  assert.deepEqual(Object.keys(c.sizes), ["XS", "S", "M", "L", "XL"]);
  assert.equal(c.garmentType, "other");
});

test("parseCandidates rejects an answer that is not the agreed shape", () => {
  const bad: unknown[] = [null, {}, "list", [{ name: "No id", sizes: {} }], [{ id: "a", name: 5, sizes: {} }], [{ id: "a", name: "No sizes" }]];
  for (const raw of bad) {
    assert.throws(() => parseCandidates(raw), (e: unknown) => e instanceof ApiError && e.kind === "invalid", JSON.stringify(raw));
  }
});

test("parseRecommendResponse rejects an answer with a missing or mistyped field", () => {
  const bad: unknown[] = [
    null,
    [],
    { ...sized, size: 5 },
    { ...sized, confidence: "certain" },
    { ...sized, matchPercent: "67.6" },
    { ...sized, fitsLike: 3 },
    { ...sized, verdict: undefined },
    { ...sized, notes: "none" },
    { ...sized, notes: [1] },
    { ...sized, sizes: "M" },
    { ...sized, sizes: [{ matchPercent: 67.6, fitsLike: "blue-tee" }] },
    { ...sized, sizes: [{ size: "M", matchPercent: "67.6", fitsLike: "blue-tee" }] },
    { ...sized, sizes: [{ size: "M", matchPercent: 67.6, fitsLike: 3 }] },
    { ...sized, similar: {} },
    { ...sized, similar: [{ shirtId: "blue-tee", matchPercent: null }] },
    { ...sized, similar: [{ matchPercent: 67.6 }] },
  ];
  for (const raw of bad) {
    assert.throws(() => parseRecommendResponse(raw), (e: unknown) => e instanceof ApiError && e.kind === "invalid", JSON.stringify(raw));
  }
  assert.deepEqual(parseRecommendResponse({ ...sized, extra: true }), sized); // extra fields are dropped
  assert.deepEqual(parseRecommendResponse(notSized), notSized); // a size with nothing to compare keeps its nulls
});

test("parseRecommendResponse reads an answer saved before sizes and similar existed as two empty lists", () => {
  const { sizes: _sizes, similar: _similar, ...older } = sized;
  assert.deepEqual(parseRecommendResponse(older), { ...sized, sizes: [], similar: [] });
});
