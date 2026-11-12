/**
 * Vercel Speed Insights Initialization
 * 
 * This script loads Vercel Speed Insights for the Pearfit website.
 * Speed Insights automatically tracks Web Vitals and other performance metrics.
 * 
 * Implementation follows the official Vercel documentation:
 * https://vercel.com/docs/speed-insights/quickstart
 * 
 * Note: Speed Insights only tracks data in production (when deployed to Vercel).
 * No data is collected in development mode.
 *
 * It loads only after the visitor has accepted analytics (consent.js). With no choice or a "decline" it is not requested.
 * Declining after accepting stops it from the next page: a script that has run cannot be taken back out of a page.
 * 
 * For vanilla JavaScript projects deployed to Vercel, the Speed Insights script
 * is automatically injected at /_vercel/speed-insights/script.js
 */

(function initSpeedInsights() {
  // Check if we're in development mode
  const isDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  
  if (isDevelopment) {
    console.debug('Speed Insights: Development mode detected. No data will be tracked.');
    return;
  }

  let loaded = false;
  const consentGranted = () => Boolean(window.PearfitConsent) && window.PearfitConsent.get() === 'granted';

  function load() {
    if (loaded || !consentGranted()) return;
    loaded = true;
    // In production, load the Speed Insights script.
    // When deployed to Vercel, the script is available at /_vercel/speed-insights/script.js
    const script = document.createElement('script');
    script.src = '/_vercel/speed-insights/script.js';
    script.defer = true;
    script.setAttribute('data-sdkn', '@vercel/speed-insights');
    script.setAttribute('data-sdkv', '2.1.0');

    // Add error handler in case the script is not available
    script.onerror = function () {
      // Silently fail if Speed Insights is not configured in Vercel Dashboard
      console.debug('Speed Insights script not available. Ensure it is enabled in the Vercel Dashboard.');
    };

    document.head.appendChild(script);
  }

  load();
  window.addEventListener('pearfit:consent', load);
})();
