// Tests for the API layer (engine/api). Expected values are computed by hand from the default TOPS weights:
// chest 1.0, length 0.4, sleeve 0.3 (sum 1.7); matchPct = 100 * exp(-d / 3).
//
// The worked example used throughout: candidate M of 56 / 72 / 63 against a tee of 54 / 72 / 63.
//   ease: chest +2, nothing else.  distance = (1.0 * 2) / 1.7 = 1.18 (2 decimals);  match = 100 * exp(-1.1765 / 3) = 67.6
//   1.18 is under the 1.5 cm "high" band, with no near-tie and no guard hit, so the confidence is "high".
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCache } from "../api/cache.ts";
import { isAllowedOrigin } from "../api/cors.ts";
import { createCandidatesHandler, createRecommendHandler } from "../api/handlers.ts";
import type { ApiRequest, ApiResponse } from "../api/http.ts";
import { toPickerCandidates, toRecommendResponse, validateRecommendRequest } from "../api/recommend-api.ts";
import { recommend } from "../src/recommend.ts";
import type { Candidate, Measurements } from "../src/types.ts";

const m = (chest: number | null, length: number | null, sleeve: number | null): Measurements => ({
  chest_cm: chest, length_cm: length, sleeve_cm: sleeve,
});
const blueTee = { id: "blue-tee", label: "great", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: 63 } };
const teeCandidate: Candidate = { id: "e100-000", name: "Test tee", review: null, garmentType: "tee", sizes: { M: m(56, 72, 63) } };
const poloCandidate: Candidate = { id: "e200-000", name: "Test polo", review: null, garmentType: "polo", sizes: { M: m(56, 72, 63) } };
const emptyChart: Candidate = { id: "e300-000", name: "Empty chart tee", review: null, garmentType: "tee", sizes: { M: m(null, null, null) } };
const lengthOnly: Candidate = { id: "e400-000", name: "Length only tee", review: null, sizes: { M: m(null, 70, null) } };
const candidates = [teeCandidate, poloCandidate, emptyChart, lengthOnly];

// ---- request validation ----

test("validation rejects a body that is not a JSON object", () => {
  for (const body of [null, undefined, [], "text", 5]) {
    const v = validateRecommendRequest(body);
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.error, /Request body must be a JSON object/);
  }
});

test("validation rejects a missing, blank, non-string or too long candidateId", () => {
  const bad = [undefined, "", "   ", 7, "x".repeat(101)];
  for (const candidateId of bad) {
    const v = validateRecommendRequest({ wardrobe: [blueTee], candidateId });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, '"candidateId" must be a non-empty string of at most 100 characters.');
  }
  assert.equal(validateRecommendRequest({ wardrobe: [blueTee], candidateId: "x".repeat(100) }).ok, true); // 100 is the limit
});

test("validation rejects a wardrobe that is missing, not an array, empty, or over 200 shirts", () => {
  for (const wardrobe of [undefined, "shirts", {}, []]) {
    const v = validateRecommendRequest({ wardrobe, candidateId: "e100-000" });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, '"wardrobe" must be a non-empty array of owned shirts.');
  }
  const many = Array.from({ length: 201 }, (_, i) => ({ ...blueTee, id: `shirt-${i}` }));
  const v = validateRecommendRequest({ wardrobe: many, candidateId: "e100-000" });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.error, '"wardrobe" has 201 shirts; the limit is 200.');
  assert.equal(validateRecommendRequest({ wardrobe: many.slice(0, 200), candidateId: "e100-000" }).ok, true);
});

test("validation reuses the wardrobe-file rules and names the failing shirt", () => {
  const cases: [unknown, RegExp][] = [
    [{ ...blueTee, id: "Blue Tee" }, /^wardrobe \[1\]: id must be lowercase-with-dashes, got "Blue Tee"$/],
    [{ ...blueTee, id: "blue-tee" }, /^wardrobe \[1\]: duplicate id "blue-tee"$/],
    [{ ...blueTee, id: "x", label: "ok" }, /^wardrobe \[1\]: label must be "great", "tight" or "loose", got "ok"$/],
    [{ ...blueTee, id: "x", measurements: { chest_cm: "54" } }, /^wardrobe \[1\] x: chest_cm must be a positive number or null, got "54"$/],
    [{ ...blueTee, id: "x", measurements: { chest_cm: -3 } }, /chest_cm must be a positive number or null, got -3/],
    [{ ...blueTee, id: "x", garmentType: "pollo" }, /garmentType must be one of tee, tee_long_sleeve, polo, button_shirt, jacket, other, got "pollo"/],
  ];
  for (const [shirt, expected] of cases) {
    const v = validateRecommendRequest({ wardrobe: [blueTee, shirt], candidateId: "e100-000" });
    assert.equal(v.ok, false, JSON.stringify(shirt));
    if (!v.ok) assert.match(v.error, expected);
  }
});

test("a valid request is normalised: id trimmed, nulls and garmentType kept, extra fields ignored", () => {
  const polo = { id: "grey-polo", label: "tight", garmentType: "polo", measurements: { chest_cm: 55, length_cm: null }, extra: 1 };
  const v = validateRecommendRequest({ wardrobe: [blueTee, polo], candidateId: "  E100-000 ", ignored: true });
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.candidateId, "E100-000");
  assert.deepEqual(v.wardrobe, [
    { id: "blue-tee", label: "great", measurements: { chest_cm: 54, length_cm: 72, sleeve_cm: 63 } },
    // length_cm was null and sleeve_cm missing: both come out null, nothing is filled in
    { id: "grey-polo", label: "tight", garmentType: "polo", measurements: { chest_cm: 55, length_cm: null, sleeve_cm: null } },
  ]);
});

// ---- response shape ----

test("the response carries size, confidence, matchPercent, fitsLike, verdict, notes and garmentType", () => {
  const wardrobe = [{ ...blueTee, label: "great" as const }];
  const response = toRecommendResponse(recommend(wardrobe, teeCandidate), teeCandidate);
  assert.deepEqual(response, {
    size: "M",
    confidence: "high",
    matchPercent: 67.6,
    fitsLike: "blue-tee",
    verdict: "Get the M, fits like your blue tee.",
    notes: [],
    garmentType: "tee",
  });
});

test("with no recommendation, size, matchPercent and fitsLike are null, not invented", () => {
  const wardrobe = [{ ...blueTee, label: "great" as const }]; // a tee wardrobe, a polo candidate: nothing comparable
  assert.deepEqual(toRecommendResponse(recommend(wardrobe, poloCandidate), poloCandidate), {
    size: null,
    confidence: "low",
    matchPercent: null,
    fitsLike: null,
    verdict: "No comparable shirts in your wardrobe. This is a polo, and your wardrobe has none.",
    notes: [],
    garmentType: "polo",
  });
});

test("a candidate with no garmentType is reported as a tee, and a null measurement stays out of the match", () => {
  // Length only: 70 vs the tee's 72 is -2 cm, so distance = (0.4 * 2) / 0.4 = 2.0 (only length is present);
  // match = 100 * exp(-2 / 3) = 51.3. Chest is missing, which the engine notes and which drops one confidence level.
  const wardrobe = [{ ...blueTee, label: "great" as const }];
  const response = toRecommendResponse(recommend(wardrobe, lengthOnly), lengthOnly);
  assert.equal(response.garmentType, "tee");
  assert.equal(response.size, "M");
  assert.equal(response.matchPercent, 51.3);
  assert.equal(response.confidence, "low"); // band 1 (2.0 is between 1.5 and 3) plus one downgrade for the missing chest
  assert.deepEqual(response.notes, ["Chest is missing on this shirt or your closest match, so the comparison is weaker."]);
});

// ---- the picker list ----

test("the picker lists only candidates the engine can size, with nulls passed through", () => {
  const list = toPickerCandidates(candidates);
  assert.deepEqual(list.map((c) => c.id), ["e100-000", "e400-000"]); // not the polo, not the all-null chart
  assert.deepEqual(list[1], {
    id: "e400-000",
    name: "Length only tee",
    garmentType: "tee", // missing on the candidate means tee
    sizes: { M: { chest_cm: null, length_cm: 70, sleeve_cm: null } },
  });
  assert.deepEqual(Object.keys(list[0]).sort(), ["garmentType", "id", "name", "sizes"]);
});

// ---- cache ----

test("the candidate cache loads once per 5 minutes, shares a load in flight, and does not cache a failure", async () => {
  let now = 1_000;
  let loads = 0;
  const get = createCache(async () => { loads++; return [loads]; }, 5 * 60 * 1000, () => now);

  assert.deepEqual(await get(), [1]);
  now += 5 * 60 * 1000 - 1; // 299,999 ms later: still fresh
  assert.deepEqual(await get(), [1]);
  assert.equal(loads, 1);
  now += 1; // exactly 300,000 ms: expired
  assert.deepEqual(await get(), [2]);
  assert.equal(loads, 2);

  now += 5 * 60 * 1000;
  const [a, b] = await Promise.all([get(), get()]); // two callers at once share one load
  assert.deepEqual(a, b);
  assert.equal(loads, 3);

  let fail = true;
  let attempts = 0;
  const flaky = createCache(async () => { attempts++; if (fail) throw new Error("down"); return ["ok"]; }, 1000, () => now);
  await assert.rejects(flaky(), /down/);
  fail = false;
  assert.deepEqual(await flaky(), ["ok"]); // the failure was not remembered
  assert.equal(attempts, 2);
});

// ---- CORS ----

test("only pearfit.app and localhost origins are allowed", () => {
  const allowed = ["https://pearfit.app", "https://www.pearfit.app", "http://localhost", "http://localhost:3000", "http://localhost:5173"];
  const blocked = [
    undefined, "", "null", "https://example.com", "http://pearfit.app", "https://pearfit.app.evil.com",
    "https://evilpearfit.app", "https://app.pearfit.app", "http://localhost.evil.com", "https://localhost", "http://127.0.0.1:3000",
  ];
  for (const o of allowed) assert.equal(isAllowedOrigin(o), true, o);
  for (const o of blocked) assert.equal(isAllowedOrigin(o), false, String(o));
});

// ---- handlers (fake request and response, injected candidates) ----

function call(handler: (req: ApiRequest, res: ApiResponse) => Promise<void>, req: Partial<ApiRequest>) {
  const out: { status: number; headers: Record<string, string>; body?: unknown } = { status: 200, headers: {} };
  const res: ApiResponse = {
    status(code) { out.status = code; return res; },
    setHeader(name, value) { out.headers[name] = value; },
    json(body) { out.body = body; },
    end() {},
  };
  return handler({ headers: {}, ...req }, res).then(() => out);
}
const recommendHandler = createRecommendHandler({ getCandidates: async () => candidates });
const goodBody = { wardrobe: [blueTee], candidateId: "E100-000" }; // upper case: ids are the lowercased SKU

test("POST /recommend returns the engine's answer, matches the SKU in any case, and sets CORS only for allowed origins", async () => {
  const ok = await call(recommendHandler, { method: "POST", body: goodBody, headers: { origin: "https://pearfit.app" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, {
    size: "M", confidence: "high", matchPercent: 67.6, fitsLike: "blue-tee",
    verdict: "Get the M, fits like your blue tee.", notes: [], garmentType: "tee",
  });
  assert.equal(ok.headers["Access-Control-Allow-Origin"], "https://pearfit.app");
  assert.equal(ok.headers["Cache-Control"], "no-store");

  const other = await call(recommendHandler, { method: "POST", body: goodBody, headers: { origin: "https://evil.example" } });
  assert.equal(other.status, 200); // the API still answers; the browser is what is blocked
  assert.equal("Access-Control-Allow-Origin" in other.headers, false);
});

test("POST /recommend accepts a JSON string body and rejects broken JSON with 400", async () => {
  const asString = await call(recommendHandler, { method: "POST", body: JSON.stringify(goodBody) });
  assert.equal(asString.status, 200);
  const broken = await call(recommendHandler, { method: "POST", body: "{not json" });
  assert.equal(broken.status, 400);
  assert.deepEqual(broken.body, { error: "Request body is not valid JSON." });
});

test("POST /recommend answers 400 for invalid input, 404 for an unknown candidate, 405 for the wrong method", async () => {
  const bad = await call(recommendHandler, { method: "POST", body: { wardrobe: [], candidateId: "e100-000" } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { error: '"wardrobe" must be a non-empty array of owned shirts.' });

  const unknown = await call(recommendHandler, { method: "POST", body: { ...goodBody, candidateId: "nope" } });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'No candidate "nope".' });

  const wrongMethod = await call(recommendHandler, { method: "GET" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.Allow, "POST, OPTIONS");
});

test("a candidate the wardrobe cannot be compared with is a 200 with nulls, not an error", async () => {
  const r = await call(recommendHandler, { method: "POST", body: { ...goodBody, candidateId: "e200-000" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    size: null, confidence: "low", matchPercent: null, fitsLike: null,
    verdict: "No comparable shirts in your wardrobe. This is a polo, and your wardrobe has none.", notes: [], garmentType: "polo",
  });
});

test("a candidate-loading failure is a 502 with the reason", async () => {
  const down = createRecommendHandler({ getCandidates: async () => { throw new Error("Supabase down"); } });
  const r = await call(down, { method: "POST", body: goodBody });
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: "Could not load candidates: Supabase down" });
});

test("OPTIONS preflight is a 204, with CORS headers only for allowed origins", async () => {
  const good = await call(recommendHandler, { method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
  assert.equal(good.status, 204);
  assert.equal(good.headers["Access-Control-Allow-Origin"], "http://localhost:5173");
  assert.equal(good.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
  const evil = await call(recommendHandler, { method: "OPTIONS", headers: { origin: "https://pearfit.app.evil.com" } });
  assert.equal(evil.status, 204);
  assert.equal("Access-Control-Allow-Origin" in evil.headers, false);
});

test("GET /candidates returns the picker list; other methods get 405", async () => {
  const handler = createCandidatesHandler({ getCandidates: async () => candidates });
  const r = await call(handler, { method: "GET", headers: { origin: "https://www.pearfit.app" } });
  assert.equal(r.status, 200);
  assert.deepEqual((r.body as { id: string }[]).map((c) => c.id), ["e100-000", "e400-000"]);
  assert.equal(r.headers["Access-Control-Allow-Origin"], "https://www.pearfit.app");
  assert.equal(r.headers["Access-Control-Allow-Methods"], "GET, OPTIONS");
  assert.equal((await call(handler, { method: "POST" })).status, 405);
});
