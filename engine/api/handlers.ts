// The two endpoints, written against injected dependencies so they run without Vercel or the network.
import { recommend } from "../src/recommend.ts";
import type { Candidate } from "../src/types.ts";
import { slug } from "../cli/candidate-source.ts";
import { applyCors } from "./cors.ts";
import { sendJson } from "./http.ts";
import type { ApiRequest, ApiResponse } from "./http.ts";
import { toPickerCandidates, toRecommendResponse, validateRecommendRequest } from "./recommend-api.ts";

export interface Deps {
  getCandidates: () => Promise<Candidate[]>;
}
type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>;

// Vercel parses a JSON body for us; a string means the client sent JSON with another content type.
function parseBody(body: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof body !== "string") return { ok: true, value: body };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

async function loadCandidates(deps: Deps, res: ApiResponse): Promise<Candidate[] | null> {
  try {
    return await deps.getCandidates();
  } catch (e) {
    sendJson(res, 502, { error: `Could not load candidates: ${(e as Error).message}` });
    return null;
  }
}

export function createRecommendHandler(deps: Deps): Handler {
  return async (req, res) => {
    applyCors(req, res, "POST, OPTIONS");
    if (req.method === "OPTIONS") return void res.status(204).end();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return sendJson(res, 405, { error: "Use POST." });
    }
    res.setHeader("Cache-Control", "no-store");

    const body = parseBody(req.body);
    if (!body.ok) return sendJson(res, 400, { error: "Request body is not valid JSON." });
    const request = validateRecommendRequest(body.value);
    if (!request.ok) return sendJson(res, 400, { error: request.error });

    const candidates = await loadCandidates(deps, res);
    if (!candidates) return;
    // Candidate ids are the lowercased SKU, so "E483970-000" and "e483970-000" are the same candidate.
    const candidate = candidates.find((c) => c.id === slug(request.candidateId));
    if (!candidate) return sendJson(res, 404, { error: `No candidate "${request.candidateId}".` });

    sendJson(res, 200, toRecommendResponse(recommend(request.wardrobe, candidate), candidate));
  };
}

export function createCandidatesHandler(deps: Deps): Handler {
  return async (req, res) => {
    applyCors(req, res, "GET, OPTIONS");
    if (req.method === "OPTIONS") return void res.status(204).end();
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, OPTIONS");
      return sendJson(res, 405, { error: "Use GET." });
    }
    const candidates = await loadCandidates(deps, res);
    if (!candidates) return;
    res.setHeader("Cache-Control", "public, max-age=60");
    sendJson(res, 200, toPickerCandidates(candidates));
  };
}
