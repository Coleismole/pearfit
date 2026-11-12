/**
 * Visitor consent for analytics. Nothing that measures visitors loads until the visitor says yes.
 *
 *   PearfitConsent.get()        -> 'granted' | 'denied' | null (not decided)
 *   PearfitConsent.set('granted')   stores the choice, tells the page, hides the banner
 *   PearfitConsent.open()       shows the banner again (the footer's "Privacy choices" button)
 *
 * The choice is kept in this browser's localStorage under `pearfit.consent.v1`. The scraper page, which shares this
 * origin, reads the same key (webscraper/analytics.ts) and sends nothing unless it says 'granted'. A change is announced
 * on the window as a `pearfit:consent` event with { detail: { value } }; posthog-init.js, speed-insights-init.js and
 * analytics.js listen for it. Declining is as easy as accepting: two buttons of the same size, and no choice means no.
 *
 * Works as a plain browser script (window.PearfitConsent) and as a CommonJS module for the unit tests.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PearfitConsent = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const KEY = 'pearfit.consent.v1';
  const EVENT = 'pearfit:consent';
  const BANNER_ID = 'consent-banner';

  /** The choice, kept in memory and in `storage`. A storage that is missing or throws (private mode) just means the choice is not remembered. */
  function createStore(storage) {
    let memory = null;
    return {
      get() {
        if (memory) return memory;
        try {
          const value = storage && storage.getItem(KEY);
          return value === 'granted' || value === 'denied' ? value : null;
        } catch {
          return null;
        }
      },
      /** Returns false for anything but 'granted' or 'denied'. */
      set(value) {
        if (value !== 'granted' && value !== 'denied') return false;
        memory = value;
        try {
          if (storage) storage.setItem(KEY, value);
        } catch {
          // The choice holds for this page view only.
        }
        return true;
      },
    };
  }

  function localStore() {
    try {
      return root.localStorage || null;
    } catch {
      return null;
    }
  }

  const store = createStore(localStore());

  function announce(value) {
    if (typeof root.dispatchEvent !== 'function' || typeof root.CustomEvent !== 'function') return;
    root.dispatchEvent(new root.CustomEvent(EVENT, { detail: { value } }));
  }

  // ---- The banner ----

  function el(tag, attributes, text) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes || {})) node.setAttribute(name, value);
    if (text) node.textContent = text;
    return node;
  }

  function buildBanner() {
    const banner = el('div', { class: 'consent', id: BANNER_ID, role: 'region', 'aria-label': 'Privacy choices' });
    const text = el('p', { class: 'consent-text' });
    text.append(
      el('strong', {}, 'Can we use analytics? '),
      'If you accept, we load PostHog to count visits and record how the site is used, including session replays, and Vercel Speed Insights to measure how fast pages load. If you decline, neither loads. You can change this at any time with “Privacy choices” in the footer. ',
      el('a', { href: '/privacy.html' }, 'Privacy notice'),
    );
    const actions = el('div', { class: 'consent-actions' });
    const decline = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'data-consent': 'denied' }, 'Decline');
    const accept = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'data-consent': 'granted' }, 'Accept');
    actions.append(decline, accept);
    banner.append(text, actions);
    banner.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-consent]') : null;
      if (button) set(button.getAttribute('data-consent'));
    });
    return banner;
  }

  function show(focus) {
    if (typeof document === 'undefined' || !document.body) return;
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = buildBanner();
      document.body.appendChild(banner);
    }
    banner.hidden = false;
    if (focus) banner.querySelector('button').focus();
  }

  function hide() {
    if (typeof document === 'undefined') return;
    const banner = document.getElementById(BANNER_ID);
    if (banner) banner.hidden = true;
  }

  function get() {
    return store.get();
  }

  function set(value) {
    if (!store.set(value)) return false;
    hide();
    announce(value);
    return true;
  }

  function init() {
    if (typeof document === 'undefined') return;
    // Footer buttons marked data-consent-open bring the banner back.
    document.addEventListener('click', (event) => {
      const opener = event.target instanceof Element ? event.target.closest('[data-consent-open]') : null;
      if (opener) show(true);
    });
    const start = () => {
      if (get() === null) show(false);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  init();

  return { KEY, EVENT, createStore, get, set, open: () => show(true) };
});
