// Types for the values Vite puts into the bundle.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
}

// The "version" field of package.json, set in vite.config.ts.
declare const __APP_VERSION__: string;
