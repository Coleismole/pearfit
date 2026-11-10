(async function initializePostHog() {
  const developmentHosts = ['localhost', '127.0.0.1'];
  const isDevelopment = developmentHosts.includes(window.location.hostname);

  function reportMissing(variableName) {
    if (isDevelopment) {
      console.error(
        new Error(
          `${variableName} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variableName} is configured`
        )
      );
    }
  }

  // Tells analytics.js that PostHog is not coming (no config, no /api, a blocked script), so it drops queued events.
  function reportUnavailable() {
    window.dispatchEvent(new Event('posthog:unavailable'));
  }

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
    script.onerror = reportUnavailable;
    document.head.appendChild(script);
  } catch (error) {
    reportUnavailable();
    if (isDevelopment) console.error(error);
  }
})();
