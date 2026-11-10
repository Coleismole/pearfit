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

  try {
    const response = await fetch('/api/posthog-config');
    const { projectToken, host } = await response.json();

    if (!projectToken) reportMissing('POSTHOG_PROJECT_TOKEN');
    if (!host) reportMissing('POSTHOG_HOST');
    if (!projectToken || !host) return;

    const script = document.createElement('script');
    script.src = `${host.replace(/\/$/, '')}/static/array.js`;
    script.async = true;
    script.onload = () => {
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
      window.dispatchEvent(new Event('posthog:initialized'));
      window.posthog.logger?.info?.('marketing site initialized', { entry_point: 'page_load' });
    };
    document.head.appendChild(script);
  } catch (error) {
    if (isDevelopment) console.error(error);
  }
})();
