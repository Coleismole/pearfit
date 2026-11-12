/**
 * The marketing site's event layer. Every event the site sends to PostHog goes through `track(name, props)`.
 *
 *   PearfitAnalytics.track('demo_started', { source: 'picked_candidate' });
 *
 * Why a layer and not `posthog.capture` calls: PostHog may never load (the visitor has not accepted analytics,
 * an ad blocker, no project token, the GitHub Pages copy of the site with no /api), and the page must behave the same then. `track` never throws,
 * queues until PostHog has started, and drops the queue once it is known not to be coming.
 *
 * Privacy rule (same as webscraper/analyticsEvents.ts): send the store's hostname and counts, never review
 * text, names, emails, a full URL a visitor typed, or an error message. The EVENTS table below is the
 * allow-list: an event not listed is dropped, a property not listed for that event is dropped, and a string
 * that looks like a URL or an email address is dropped. Names are snake_case, object then past-tense verb
 * (`scrape_completed` in the scraper app, `demo_completed` here). The list is documented in website/README.md.
 *
 * Works as a plain browser script (window.PearfitAnalytics) and as a CommonJS module for the unit tests.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PearfitAnalytics = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /**
   * Event name -> the properties it may carry.
   * @typedef {'section_viewed'|'scraper_link_clicked'|'stores_link_clicked'|'demo_started'|'demo_completed'
   *   |'demo_failed'|'store_search_used'|'store_filter_used'|'fit_size_inspected'|'stakeholder_audience_selected'|'fit_recommendation_explored'|'fit_reference_selected'
   *   |'roi_calculator_adjusted'|'inquiry_mode_selected'|'inquiry_submitted'} EventName
   * @type {Readonly<Record<EventName, readonly string[]>>}
   */
  const EVENTS = Object.freeze({
    // Landing page: how far a visitor read. One event per section per page view.
    section_viewed: ['section'],
    // Link-outs. `location` is where on the page the link was: header, footer, or the id of a section.
    scraper_link_clicked: ['location'],
    stores_link_clicked: ['location'],
    // Live demo. `source` is picked_candidate, pasted_url or candidate_list (the product list failed to load).
    // `host` is the hostname of a pasted link, never the link. `candidate_id` is a public product id from the
    // fit table, `reason` one of network, timeout, bad_request, not_found, server, invalid_response, no_match.
    // The shirts a visitor types (names, measurements) are never sent.
    demo_started: ['source', 'host', 'candidate_id', 'wardrobe_size'],
    demo_completed: ['source', 'host', 'candidate_id', 'wardrobe_size', 'size', 'confidence', 'has_fits_like', 'duration_ms'],
    demo_failed: ['source', 'host', 'candidate_id', 'reason', 'status', 'duration_ms'],
    // Supported stores page. The search text is never sent: its length, a hostname when it is a domain name, and how
    // many stores matched. `filter` is platform, size_chart, size_bought or fit_answer; `value` one of our own options.
    store_search_used: ['query_length', 'host', 'result_count'],
    store_filter_used: ['filter', 'value', 'result_count'],
    // The sample preview and calculators already on the page (names unchanged so existing charts keep working).
    fit_size_inspected: ['product_id', 'selected_size'],
    stakeholder_audience_selected: ['audience'],
    fit_recommendation_explored: ['interaction', 'usual_size', 'recommended_size'],
    fit_reference_selected: ['reference_garment_id'],
    roi_calculator_adjusted: ['input_name'],
    inquiry_mode_selected: ['inquiry_mode'],
    inquiry_submitted: ['inquiry_mode'],
  });

  const MAX_STRING = 80;
  const MAX_QUEUE = 50;
  const SENSITIVE = /:\/\/|@/;

  /** 'waiting' until PostHog starts, then 'ready' or 'unavailable'. */
  let state = 'waiting';
  const queue = [];
  let debug = false;

  /** "https://www.uniqlo.com/ca/en/products/E1?x=1" or "uniqlo.com/p" -> "uniqlo.com". Anything else -> null. */
  function hostOf(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    try {
      const url = new URL(withScheme);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      return host.includes('.') ? host : null;
    } catch {
      return null;
    }
  }

  /** Keeps only the allowed properties of an event, and only plain values. Returns null for an unknown event. */
  function sanitize(name, props) {
    const allowed = Object.prototype.hasOwnProperty.call(EVENTS, name) ? EVENTS[name] : null;
    if (!allowed) return null;
    const clean = {};
    if (!props || typeof props !== 'object') return clean;
    for (const key of allowed) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      const value = props[key];
      if (value === null || typeof value === 'boolean') clean[key] = value;
      else if (typeof value === 'number') {
        if (Number.isFinite(value)) clean[key] = value;
      } else if (typeof value === 'string' && !SENSITIVE.test(value)) clean[key] = value.slice(0, MAX_STRING);
    }
    return clean;
  }

  function client() {
    const posthog = root.posthog;
    return posthog && typeof posthog.capture === 'function' ? posthog : null;
  }

  function run(callback) {
    if (state === 'unavailable') return false;
    if (state === 'waiting') {
      if (queue.length < MAX_QUEUE) queue.push(callback);
      return true;
    }
    const posthog = client();
    if (!posthog) return false;
    try {
      callback(posthog);
      return true;
    } catch (error) {
      if (debug) console.debug('analytics call failed', error);
      return false;
    }
  }

  /**
   * Records an event. Returns true when it was sent or queued; false when it was dropped (unknown event,
   * PostHog not coming). Never throws.
   * @param {EventName} name
   * @param {Record<string, string|number|boolean|null>} [props]
   */
  function track(name, props) {
    try {
      const clean = sanitize(name, props);
      if (!clean) {
        if (debug) console.debug(`analytics: "${name}" is not in the event list`);
        return false;
      }
      return run((posthog) => posthog.capture(name, clean));
    } catch {
      return false;
    }
  }

  /** PostHog's logger, when it has one. Messages are fixed strings; attributes go through no allow-list, so keep them to counts. */
  function log(level, message, attributes) {
    return run((posthog) => posthog.logger && posthog.logger[level] && posthog.logger[level](message, attributes));
  }

  function markReady() {
    state = 'ready';
    queue.splice(0).forEach((callback) => run(callback));
  }

  /** PostHog will not load: queued and later events are dropped instead of piling up. */
  function markUnavailable() {
    state = 'unavailable';
    queue.length = 0;
  }

  // ---- Page behaviour: section views and link-outs ----

  /** Where on the page an element is, for the `location` property. */
  function locationOf(element) {
    if (element.closest('header')) return 'header';
    if (element.closest('footer')) return 'footer';
    const section = element.closest('[data-section], main section[id]');
    if (section) return section.dataset.section || section.id;
    return 'page';
  }

  function trackSectionViews() {
    if (typeof IntersectionObserver !== 'function') return;
    const seen = new Set();
    // A section counts as viewed once any of it is in the top 60% of the screen. A ratio threshold would never
    // fire for a section taller than the screen.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const name = entry.target.dataset.section || entry.target.id;
          observer.unobserve(entry.target);
          if (!name || seen.has(name)) continue;
          seen.add(name);
          track('section_viewed', { section: name });
        }
      },
      { rootMargin: '0px 0px -40% 0px', threshold: 0 },
    );
    document.querySelectorAll('[data-section], main section[id]').forEach((section) => observer.observe(section));
  }

  function trackLinkOuts() {
    document.addEventListener('click', (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link) return;
      const path = new URL(link.getAttribute('href'), root.location.href).pathname.replace(/\/+$/, '');
      if (path === '/scraper' || path.startsWith('/scraper/')) track('scraper_link_clicked', { location: locationOf(link) });
      else if (path === '/stores' || path === '/stores.html') track('stores_link_clicked', { location: locationOf(link) });
    });
  }

  function init() {
    if (typeof document === 'undefined') return;
    debug = ['localhost', '127.0.0.1'].includes(root.location.hostname);
    root.addEventListener('posthog:initialized', markReady);
    root.addEventListener('posthog:unavailable', markUnavailable);
    root.addEventListener('pearfit:consent', (event) => {
      if (event && event.detail && event.detail.value === 'granted') resume();
    });
    // PostHog was already running when this script ran.
    if (root.posthog && root.posthog.__loaded) markReady();
    try {
      trackSectionViews();
      trackLinkOuts();
    } catch (error) {
      if (debug) console.debug('analytics setup failed', error);
    }
  }

  /**
   * The visitor accepted analytics after the page had given up on PostHog (no choice yet, or declined earlier): wait for
   * it to start. Events from before the choice were dropped and stay dropped.
   */
  function resume() {
    if (state !== 'unavailable') return;
    state = 'waiting';
    queue.length = 0;
  }

  /** Back to the starting state. For tests. */
  function reset() {
    state = 'waiting';
    queue.length = 0;
  }

  init();

  return { EVENTS, track, log, hostOf, sanitize, markReady, markUnavailable, resume, reset, MAX_QUEUE };
});
