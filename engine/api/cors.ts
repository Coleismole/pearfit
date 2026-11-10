import { ALLOWED_ORIGINS } from "./config.ts";
import type { ApiRequest, ApiResponse } from "./http.ts";

export function isAllowedOrigin(origin: string | undefined): origin is string {
  return origin !== undefined && ALLOWED_ORIGINS.some((pattern) => pattern.test(origin));
}

// Adds CORS headers only for an allowed origin. Any other caller gets none, so a browser on another site is blocked.
export function applyCors(req: ApiRequest, res: ApiResponse, methods: string): void {
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  const value = Array.isArray(origin) ? origin[0] : origin;
  if (!isAllowedOrigin(value)) return;
  res.setHeader("Access-Control-Allow-Origin", value);
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}
