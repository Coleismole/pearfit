/**
 * The supported-stores page: loads stores.json (built from webscraper/SUPPORTED_STORES.md by
 * scripts/build-stores.mjs) and lets a visitor search and filter it. Plain JS, no framework.
 *
 * The filtering and wording functions are pure so they can be unit-tested; the page wiring at the bottom only
 * runs when there is a document. Works as a plain browser script (window.PearfitStores) and as a CommonJS module.
 *
 * Search covers both lists. The platform, size chart and reviews filters apply to supported stores only: a store
 * that is not supported has no platform or reviews to filter on.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PearfitStores = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const KIND_ORDER = ['refused', 'no_reviews', 'unavailable', 'other'];
  const KIND_TITLES = {
    refused: 'Refuse automated requests',
    no_reviews: 'No reviews to read',
    unavailable: 'Down, moved or not answering',
    other: 'Other',
  };
  const LEVELS = ['yes', 'sometimes', 'no'];
  const CHART_VALUES = ['yes', 'not_recorded'];

  const words = (text) => String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

  /** Checks the file's shape. null when it is not what scripts/build-stores.mjs writes. */
  function readStores(data) {
    if (!isObject(data) || !Array.isArray(data.supported) || !Array.isArray(data.not_supported)) return null;
    const text = (v) => typeof v === 'string';
    const supported = data.supported.filter((s) => isObject(s) && text(s.id) && text(s.name));
    const notSupported = data.not_supported.filter((s) => isObject(s) && text(s.id) && text(s.name) && text(s.reason));
    return {
      testedOn: text(data.tested_on) ? data.tested_on : null,
      platforms: Array.isArray(data.platforms) ? data.platforms.filter(text) : [],
      supported: supported.map((s) => ({ ...s, notes: Array.isArray(s.notes) ? s.notes.filter(text) : [] })),
      notSupported,
    };
  }

  /**
   * criteria: { query, platform, sizeChart, sizeBought, fitAnswer }; an empty string is "any".
   * Returns the stores that match, in the file's order.
   */
  function filterStores(data, criteria) {
    const c = criteria || {};
    const terms = words(c.query);
    const matchesQuery = (haystack) => {
      const text = haystack.toLowerCase();
      return terms.every((term) => text.includes(term));
    };
    const supported = data.supported.filter((s) => {
      if (c.platform && s.platform !== c.platform) return false;
      if (c.sizeChart && s.size_chart !== c.sizeChart) return false;
      if (c.sizeBought && s.size_bought !== c.sizeBought) return false;
      if (c.fitAnswer && s.fit_answer !== c.fitAnswer) return false;
      return matchesQuery([s.name, s.platform, s.product_tested, s.reviews_from].filter(Boolean).join(' '));
    });
    const notSupported = data.notSupported.filter((s) => matchesQuery(`${s.name} ${s.reason}`));
    return { supported, notSupported };
  }

  /** Not-supported stores grouped by kind, then by identical reason, so "HTTP 403" is said once for sixty stores. */
  function groupNotSupported(stores) {
    const groups = [];
    for (const kind of KIND_ORDER) {
      const ofKind = stores.filter((s) => (KIND_ORDER.includes(s.kind) ? s.kind : 'other') === kind);
      if (ofKind.length === 0) continue;
      const byReason = new Map();
      for (const store of ofKind) byReason.set(store.reason, [...(byReason.get(store.reason) || []), store]);
      groups.push({ kind, title: KIND_TITLES[kind], reasons: [...byReason].map(([reason, list]) => ({ reason, stores: list })) });
    }
    return groups;
  }

  const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

  /** What a "Size bought" or "Fit answer" shows: the cell's own wording, capitalised; unknown when there is none. */
  function answerText(text) {
    return text ? capitalize(text) : 'unknown';
  }

  function chartText(value) {
    return value === 'yes' ? 'Read' : 'Not recorded yet';
  }

  /** The line a screen reader hears after every change of search or filter. */
  function statusText(supportedCount, notSupportedCount) {
    const stores = supportedCount === 1 ? 'store' : 'stores';
    return `${supportedCount} supported ${stores} and ${notSupportedCount} not supported yet match your search and filters.`;
  }

  const api = { KIND_TITLES, LEVELS, CHART_VALUES, readStores, filterStores, groupNotSupported, answerText, chartText, statusText };

  if (typeof document !== 'undefined') {
    root.addEventListener('DOMContentLoaded', () => initPage(api, root));
    if (document.readyState !== 'loading') initPage(api, root);
  }

  let started = false;

  function initPage(stores, win) {
    const listEl = document.getElementById('stores-supported');
    if (!listEl || started) return;
    started = true;

    const $ = (id) => document.getElementById(id);
    const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const track = (name, props) => win.PearfitAnalytics && win.PearfitAnalytics.track(name, props);
    const controls = { query: $('stores-search'), platform: $('stores-platform'), sizeChart: $('stores-chart'), sizeBought: $('stores-size'), fitAnswer: $('stores-fit') };
    const statusEl = $('stores-status');
    const unsupportedEl = $('stores-unsupported');
    const supportedCountEl = $('stores-supported-count');
    const unsupportedCountEl = $('stores-unsupported-count');
    const emptyEl = $('stores-empty');
    const loadingEl = $('stores-loading');
    const errorEl = $('stores-error');
    const filtersEl = $('stores-filters');
    const sectionEl = listEl.closest('section');

    let data = null;

    const criteria = () => ({
      query: controls.query.value,
      platform: controls.platform.value,
      sizeChart: controls.sizeChart.value,
      sizeBought: controls.sizeBought.value,
      fitAnswer: controls.fitAnswer.value,
    });

    function cardHtml(s) {
      const sizeChartOnly = s.status === 'size_chart_only';
      const facts = sizeChartOnly
        ? [['Reviews', 'None on the product pages'], ['Size chart', stores.chartText(s.size_chart)]]
        : [
            ['Reviews read / stated', s.read_stated || 'unknown'],
            ['Size bought', stores.answerText(s.size_bought_text)],
            ['Fit answer', stores.answerText(s.fit_answer_text)],
            ['Size chart', stores.chartText(s.size_chart)],
          ];
      return `
        <li class="store">
          <div class="store-head">
            <p class="store-name">${esc(s.name)}</p>
            <span class="store-tag">${esc(sizeChartOnly ? 'Size chart only' : s.platform || 'unknown')}</span>
          </div>
          ${s.product_tested ? `<p class="store-product">Tested on ${esc(s.product_tested)}</p>` : ''}
          <dl class="store-facts">${facts.map(([term, value]) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
          ${s.notes.length ? `<details class="store-notes"><summary>Limits we found</summary><ul>${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>` : ''}
        </li>`;
    }

    function render() {
      const result = stores.filterStores(data, criteria());
      listEl.innerHTML = result.supported.map(cardHtml).join('');
      const groups = stores.groupNotSupported(result.notSupported);
      unsupportedEl.innerHTML = groups
        .map(
          (g) => `
          <div class="store-group">
            <h3>${esc(g.title)}</h3>
            ${g.reasons
              .map(
                (r) => `
              <div class="store-reason">
                <p>${esc(r.reason)}</p>
                <ul class="store-chips">${r.stores.map((s) => `<li>${esc(s.name)}</li>`).join('')}</ul>
              </div>`,
              )
              .join('')}
          </div>`,
        )
        .join('');
      supportedCountEl.textContent = `${result.supported.length} of ${data.supported.length}`;
      unsupportedCountEl.textContent = `${result.notSupported.length} of ${data.notSupported.length}`;
      emptyEl.hidden = result.supported.length > 0;
      $('stores-unsupported-empty').hidden = result.notSupported.length > 0;
      statusEl.textContent = stores.statusText(result.supported.length, result.notSupported.length);
      return result;
    }

    function fillPlatforms() {
      const options = data.platforms.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
      controls.platform.insertAdjacentHTML('beforeend', options);
    }

    // The search is reported once the visitor stops typing, as its length and a hostname when it is one; never the text.
    let searchTimer = null;
    controls.query.addEventListener('input', () => {
      if (!data) return;
      const result = render();
      clearTimeout(searchTimer);
      const query = controls.query.value.trim();
      if (!query) return;
      searchTimer = setTimeout(() => {
        const host = win.PearfitAnalytics ? win.PearfitAnalytics.hostOf(query) : null;
        track('store_search_used', { query_length: query.length, host, result_count: result.supported.length + result.notSupported.length });
      }, 800);
    });

    const filterNames = { platform: 'platform', sizeChart: 'size_chart', sizeBought: 'size_bought', fitAnswer: 'fit_answer' };
    for (const key of Object.keys(filterNames)) {
      controls[key].addEventListener('change', () => {
        if (!data) return;
        const result = render();
        track('store_filter_used', { filter: filterNames[key], value: controls[key].value || 'any', result_count: result.supported.length });
      });
    }

    $('stores-reset').addEventListener('click', () => {
      if (!data) return;
      for (const control of Object.values(controls)) control.value = '';
      render();
      controls.query.focus();
    });

    async function load() {
      loadingEl.hidden = false;
      errorEl.hidden = true;
      filtersEl.hidden = true;
      let result = null;
      try {
        const response = await fetch('stores.json', { headers: { Accept: 'application/json' } });
        if (response.ok) result = stores.readStores(await response.json());
      } catch {
        result = null;
      }
      loadingEl.hidden = true;
      sectionEl.setAttribute('aria-busy', 'false');
      if (!result) {
        errorEl.hidden = false;
        return;
      }
      data = result;
      if (!controls.platform.dataset.filled) {
        fillPlatforms();
        controls.platform.dataset.filled = 'yes';
      }
      $('stores-tested').textContent = data.testedOn ? `Tested on ${data.testedOn}.` : '';
      filtersEl.hidden = false;
      render();
    }

    $('stores-retry').addEventListener('click', load);
    load();
  }

  return api;
});
