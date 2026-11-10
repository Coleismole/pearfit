// The slice of a Vercel Node function's request and response that the handlers use, so no @vercel/node
// dependency is needed and tests can pass plain objects.
export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
  end(): unknown;
}

export function sendJson(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}
