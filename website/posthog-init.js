// Loads PostHog, but only once the visitor has accepted analytics (consent.js). With no choice or a "decline", nothing is
// requested from PostHog and analytics.js drops its events. Accepting later starts PostHog in the same page view;
// declining after accepting stops it and clears what it stored.
(function initializePostHog() {
  const developmentHosts = ['localhost', '127.0.0.1'];
  const isDevelopment = developmentHosts.includes(window.location.hostname);
  let starting = false;

  function reportMissing(variableName) {
    if (isDevelopment) {
      console.error(
        new Error(
          `${variableName} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variableName} is configured`
        )
      );
    }
  }

  // Tells analytics.js that PostHog is not coming (no consent, no config, no /api, a blocked script), so it drops queued events.
  function reportUnavailable() {
    window.dispatchEvent(new Event('posthog:unavailable'));
  }

  function consentGranted() {
    return Boolean(window.PearfitConsent) && window.PearfitConsent.get() === 'granted';
  }

  async function start() {
    if (starting) return;
    starting = true;
    try {
      const response = await fetch('/api/posthog-config');
      if (!response.ok) {
        reportUnavailable();
        return;
      }
      const { projectToken, host } = await response.json();

      if (!projectToken) reportMissing('POSTHOG_PROJECT_TOKEN');
      if (!host) reportMissing('POSTHOG_HOST');
      if (!projectToken || !host) {
        reportUnavailable();
        return;
      }
      // The visitor may have changed their mind while the config was loading.
      if (!consentGranted()) {
        reportUnavailable();
        return;
      }

      const script = document.createElement('script');
      script.src = `${host.replace(/\/$/, '')}/static/array.js`;
      script.async = true;
      script.onload = () => {
        try {
          window.posthog.init(projectToken, {
            api_host: host,
            capture_exceptions: {
              capture_unhandled_errors: true,
              capture_unhandled_rejections: true,
              capture_console_errors: false,
            },
            logs: {
              serviceName: 'pearfit-marketing-site',
              environment: isDevelopment ? 'development' : 'production',
            },
          });
          // Tells marketing-site events from scraper events (the scraper registers app: 'pearfit-scraper').
          window.posthog.register?.({ app: 'pearfit-marketing-site', environment: isDevelopment ? 'development' : 'production' });
        } catch (error) {
          starting = false;
          reportUnavailable();
          if (isDevelopment) console.error(error);
          return;
        }
        window.dispatchEvent(new Event('posthog:initialized'));
        try {
          window.posthog.logger?.info?.('marketing site initialized', { entry_point: 'page_load' });
        } catch {
          // The logger is optional; losing it must not mark PostHog as unavailable.
        }
      };
      script.onerror = () => {
        starting = false;
        reportUnavailable();
      };
      document.head.appendChild(script);
    } catch (error) {
      starting = false;
      reportUnavailable();
      if (isDevelopment) console.error(error);
    }
  }

  // PostHog was started earlier in this page view and the visitor accepted again.
  function resume() {
    try {
      window.posthog.opt_in_capturing?.();
    } catch {
      // Starting again below is the fallback.
    }
    window.dispatchEvent(new Event('posthog:initialized'));
  }

  // The visitor declined after accepting: stop capturing, forget who they were, and remove what PostHog stored here.
  function stop() {
    try {
      window.posthog?.opt_out_capturing?.();
      window.posthog?.reset?.();
    } catch {
      // Nothing more to do; the storage below is cleared either way.
    }
    try {
      for (const storage of [window.localStorage, window.sessionStorage]) {
        Object.keys(storage)
          .filter((key) => key.startsWith('ph_') || key.startsWith('__ph_'))
          .forEach((key) => storage.removeItem(key));
      }
      const hostname = window.location.hostname;
      const domains = ['', `; domain=${hostname}`, `; domain=.${hostname.replace(/^www\./, '')}`];
      document.cookie
        .split(';')
        .map((cookie) => cookie.split('=')[0].trim())
        .filter((name) => name.startsWith('ph_') || name.startsWith('__ph_'))
        .forEach((name) => domains.forEach((domain) => (document.cookie = `${name}=; Max-Age=0; path=/${domain}`)));
    } catch {
      // Storage can be blocked; there is then nothing of ours in it.
    }
    reportUnavailable();
  }

  if (consentGranted()) start();
  else reportUnavailable();

  window.addEventListener('pearfit:consent', (event) => {
    if (event.detail && event.detail.value === 'granted') {
      if (window.posthog && window.posthog.__loaded) resume();
      else start();
    } else {
      stop();
    }
  });
})();
