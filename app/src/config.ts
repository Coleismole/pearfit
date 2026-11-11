// The one place the API base URL is set. Every request the app makes goes to `${API_BASE_URL}/api/...`
// (see src/lib/api.ts). To use another deployment, set VITE_API_BASE_URL (see .env.example): it replaces
// this default at build and dev time.
const DEFAULT_API_BASE_URL = "https://www.pearfit.app";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
