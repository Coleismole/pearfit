/**
 * Vercel Speed Insights Initialization
 * 
 * This script initializes Vercel Speed Insights for the Pearfit website.
 * Speed Insights automatically tracks Web Vitals and other performance metrics.
 * 
 * Note: Speed Insights only tracks data in production (when deployed to Vercel).
 * No data is collected in development mode.
 * 
 * For vanilla JavaScript projects deployed to Vercel, Speed Insights is automatically
 * injected by the platform. This script sets up the tracking queue for manual injection
 * or provides fallback initialization.
 */

(function initSpeedInsights() {
  // Initialize the Speed Insights queue
  // This allows events to be queued before the main script loads
  if (!window.si) {
    window.si = window.si || function() {
      (window.siq = window.siq || []).push(arguments);
    };
  }
  
  // When deployed to Vercel, the Speed Insights script is automatically injected
  // at /_vercel/speed-insights/script.js
  // We can verify it's available and load it if needed
  const isDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  
  // In production (Vercel deployment), the script is automatically injected
  // In development, Speed Insights won't track data
  if (!isDevelopment && !window.sil) {
    const script = document.createElement('script');
    script.src = '/_vercel/speed-insights/script.js';
    script.defer = true;
    script.setAttribute('data-sdkn', '@vercel/speed-insights');
    script.setAttribute('data-sdkv', '2.1.0');
    
    // Add error handler in case the script is not available
    script.onerror = function() {
      // Silently fail if Speed Insights is not configured in Vercel Dashboard
      console.debug('Speed Insights script not available. Enable it in Vercel Dashboard.');
    };
    
    document.head.appendChild(script);
  } else if (isDevelopment) {
    console.debug('Speed Insights: Development mode detected. No data will be tracked.');
  }
})();
