import type { ScrapeMode } from './analyticsEvents.ts';

/**
 * PostHog for the scraper app. The project token and host come from the server (`/api/posthog-config`),
 * the same way the marketing site gets them, so nothing is baked into the build. With no token or host
 * set, every call here does nothing.
 *
 * pearfit.app and pearfit.app/scraper share one origin, so one PostHog person carries across both.
 */

interface PostHogClient {
  init: (token: string, options: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  register: (properties: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    posthog?: PostHogClient;
  }
}

let ready = false;
const pending: Array<(posthog: PostHogClient) => void> = [];

function run(callback: (posthog: PostHogClient) => void) {
  if (ready && window.posthog) callback(window.posthog);
  else pending.push(callback);
}

/** Loads PostHog once. Never throws: analytics must not break the app. */
export async function initAnalytics(configUrl: string): Promise<void> {
  try {
    const response = await fetch(configUrl);
    if (!response.ok) return;
    const { projectToken, host } = (await response.json()) as { projectToken?: string; host?: string };
    if (!projectToken || !host) return;
    const base = host.replace(/\/$/, '');
    const isDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${base}/static/array.js`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('PostHog script did not load'));
      document.head.appendChild(script);
    });
    if (!window.posthog) return;
    window.posthog.init(projectToken, {
      api_host: base,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
    });
    // Tells scraper events from marketing-site events, and local runs from production.
    window.posthog.register({ app: 'pearfit-scraper', environment: isDevelopment ? 'development' : 'production' });
    ready = true;
    pending.splice(0).forEach((callback) => run(callback));
  } catch {
    // Blocked by an ad blocker, offline, or misconfigured: the app works the same without it.
  }
}

/** Records an event, or queues it until PostHog has loaded. */
export function track(event: string, properties?: Record<string, unknown>): void {
  run((posthog) => posthog.capture(event, properties));
}

export type { ScrapeMode };
