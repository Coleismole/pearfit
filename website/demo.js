/**
 * The live size demo on the landing page: a shopper enters shirts they own, picks a product (or pastes a link to
 * one the fit table already holds) and gets the engine's answer from the site's own API.
 *
 *   GET  /api/candidates   -> [{ id, name, garmentType, sizes: { S: { chest_cm, length_cm, sleeve_cm } } }]
 *   POST /api/recommend    <- { wardrobe: [{ id, label, measurements }], candidateId }
 *                          -> { size, confidence, matchPercent, fitsLike, verdict, notes, garmentType, sizes, similar, reviews }
 *
 * Built from engine/api (read only; the shapes are checked below, and a response that does not match is shown as
 * an error rather than as a guess). Every decision is the engine's: this file only collects input, validates it
 * the way engine/cli/validate.ts does, and prints what came back. Missing is null, shown as "unknown", never filled in.
 *
 * Nothing a visitor types is stored. A pasted link is matched against the candidate ids in the browser and is
 * never fetched or sent anywhere; analytics get the hostname only.
 *
 * Works as a plain browser script (window.PearfitDemo) and as a CommonJS module for the unit tests. The pure
 * functions come first; the page wiring is at the bottom and only runs when there is a document.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PearfitDemo = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const DIMS = ['chest_cm', 'length_cm', 'sleeve_cm'];
  const DIM_LABELS = { chest_cm: 'Chest', length_cm: 'Length', sleeve_cm: 'Sleeve' };
  const FIT_LABELS = ['great', 'tight', 'loose'];
  const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
  const IN_TO_CM = 2.54;
  // The engine's own check (cli/validate.ts): a flat chest above this is almost certainly the full circumference.
  const CHEST_MAX_CM = 80;
  const OTHER_MAX_CM = 150;
  const MAX_SHIRTS = 10;
  const MIN_URL_ID_LENGTH = 5;
  const MAX_LIST = 200;
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_ERROR_TEXT = 300;

  const round1 = (n) => Math.round(n * 10) / 10;
  const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
  const isNumberOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));

  // ---- Owned shirts: parsing what the visitor typed ----

  /**
   * One measurement box. Empty is unknown (null), never zero. Inches are converted here, once (x 2.54, one decimal),
   * as the data format requires; the engine only ever sees centimeters.
   * @returns {{ ok: true, value: number | null } | { ok: false, message: string }}
   */
  function parseMeasurement(text, unit, dim) {
    const raw = String(text == null ? '' : text).trim().replace(',', '.');
    if (raw === '') return { ok: true, value: null };
    if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, message: `${DIM_LABELS[dim]}: enter a number like 54 or 21.5, or leave it empty if you do not know.` };
    const cm = round1(unit === 'in' ? parseFloat(raw) * IN_TO_CM : parseFloat(raw));
    if (!(cm > 0)) return { ok: false, message: `${DIM_LABELS[dim]}: must be more than 0. Leave it empty if you do not know.` };
    if (dim === 'chest_cm' && cm > CHEST_MAX_CM) {
      return { ok: false, message: `Chest: ${cm} cm looks like the full circumference. Measure flat, from armpit to armpit (half the circumference).` };
    }
    if (cm > OTHER_MAX_CM) return { ok: false, message: `${DIM_LABELS[dim]}: ${cm} cm is more than a shirt can be. Check the number and the unit.` };
    return { ok: true, value: cm };
  }

  /** "Blue Uniqlo Oxford!" -> "blue-uniqlo-oxford": lowercase, dashes, as the engine's wardrobe format needs. */
  function slugify(name) {
    return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'shirt';
  }

  /**
   * Turns the form rows into the request's wardrobe, or says what is wrong with which row.
   * rows: [{ name, label, chest, length, sleeve }] as typed. Ids are unique per wardrobe.
   * @returns {{ ok: true, wardrobe: object[], names: Record<string, string> } | { ok: false, errors: {row: number|null, message: string}[] }}
   */
  function buildWardrobe(rows, unit) {
    const errors = [];
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, errors: [{ row: null, message: 'Add at least one shirt you own.' }] };
    if (rows.length > MAX_SHIRTS) return { ok: false, errors: [{ row: null, message: `Up to ${MAX_SHIRTS} shirts, please.` }] };
    const wardrobe = [];
    const names = Object.create(null); // ids come from what the visitor typed, so no inherited keys
    rows.forEach((row, index) => {
      const name = String(row.name || '').trim() || `Shirt ${index + 1}`;
      if (!FIT_LABELS.includes(row.label)) {
        errors.push({ row: index, message: 'Say how this shirt fits: great, too tight or too loose.' });
        return;
      }
      const measurements = {};
      const errorsBefore = errors.length;
      for (const [dim, key] of [['chest_cm', 'chest'], ['length_cm', 'length'], ['sleeve_cm', 'sleeve']]) {
        const parsed = parseMeasurement(row[key], unit, dim);
        if (parsed.ok) measurements[dim] = parsed.value;
        else errors.push({ row: index, message: parsed.message });
      }
      if (errors.length === errorsBefore && DIMS.every((dim) => measurements[dim] === null)) {
        errors.push({ row: index, message: 'Enter at least one measurement for this shirt.' });
      }
      let id = slugify(name);
      for (let n = 2; id in names; n += 1) id = `${slugify(name)}-${n}`;
      names[id] = name;
      wardrobe.push({ id, label: row.label, measurements });
    });
    if (errors.length === 0 && !wardrobe.some((shirt) => shirt.label === 'great')) {
      errors.push({ row: null, message: 'Mark at least one shirt as fitting great. The answer is built from shirts that fit you well.' });
    }
    return errors.length ? { ok: false, errors } : { ok: true, wardrobe, names };
  }

  // ---- Choosing the product ----

  /** The part of a pasted address we may keep: the hostname, without www. Anything that is not a web address -> null. */
  function parseUrl(text) {
    const value = String(text == null ? '' : text).trim();
    if (!value) return null;
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (!host.includes('.')) return null;
      return { host, path: `${url.pathname} ${url.search}` };
    } catch {
      return null;
    }
  }

  /**
   * Finds the candidate whose id (the lowercased SKU) appears in the link, e.g. ".../products/E483970-000/00" ->
   * "e483970-000". The longest id wins. The API cannot read a link, so this only recognises products the fit table
   * already holds; anything else is reported as not found, never guessed.
   * @returns {{ ok: true, candidate: object, host: string } | { ok: false, reason: 'not_a_url' | 'no_match', host: string | null }}
   */
  function matchCandidateByUrl(text, candidates) {
    const parsed = parseUrl(text);
    if (!parsed) return { ok: false, reason: 'not_a_url', host: null };
    const haystack = `-${parsed.path.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-`;
    let best = null;
    for (const candidate of candidates) {
      const id = String(candidate.id).toLowerCase();
      if (id.length < MIN_URL_ID_LENGTH || !haystack.includes(`-${id}-`)) continue;
      if (!best || id.length > best.id.length) best = { id, candidate };
    }
    return best ? { ok: true, candidate: best.candidate, host: parsed.host } : { ok: false, reason: 'no_match', host: parsed.host };
  }

  /** Name or id contains every word typed, case-insensitive. Sorted by name, capped so a long list stays usable. */
  function filterCandidates(candidates, query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const matches = candidates.filter((c) => {
      const haystack = `${c.name} ${c.id}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    matches.sort((a, b) => a.name.localeCompare(b.name));
    return { shown: matches.slice(0, MAX_LIST), total: matches.length };
  }

  /** Size-chart rows for the table; a missing measurement prints as "unknown". */
  function chartRows(candidate) {
    return Object.entries(candidate.sizes).map(([size, m]) => ({
      size,
      cells: DIMS.map((dim) => (m[dim] === null || m[dim] === undefined ? 'unknown' : String(m[dim]))),
    }));
  }

  // ---- Reading the API's answers ----

  /** Keeps well-formed candidates; a malformed one is dropped, a missing measurement stays null. */
  function readCandidates(data) {
    if (!Array.isArray(data)) return null;
    const list = [];
    for (const item of data) {
      if (!isObject(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !isObject(item.sizes)) continue;
      const sizes = {};
      let valid = true;
      for (const [size, m] of Object.entries(item.sizes)) {
        if (!isObject(m)) { valid = false; break; }
        sizes[size] = {};
        for (const dim of DIMS) {
          const v = m[dim];
          if (v !== undefined && !isNumberOrNull(v)) { valid = false; break; }
          sizes[size][dim] = v === undefined ? null : v;
        }
        if (!valid) break;
      }
      if (valid && Object.keys(sizes).length > 0) list.push({ id: item.id, name: item.name, sizes });
    }
    return list;
  }

  /** Checks the shape of POST /api/recommend's answer. null when it is not what the API documents. */
  function readRecommendation(data) {
    if (!isObject(data)) return null;
    if (data.size !== null && typeof data.size !== 'string') return null;
    if (!CONFIDENCE_LEVELS.includes(data.confidence)) return null;
    if (typeof data.verdict !== 'string') return null;
    if (!Array.isArray(data.notes) || !data.notes.every((n) => typeof n === 'string')) return null;
    if (!(data.matchPercent === null || data.matchPercent === undefined || (typeof data.matchPercent === 'number' && Number.isFinite(data.matchPercent)))) return null;
    if (!(data.fitsLike === null || data.fitsLike === undefined || typeof data.fitsLike === 'string')) return null;
    return {
      size: data.size,
      confidence: data.confidence,
      verdict: data.verdict,
      notes: data.notes,
      matchPercent: data.matchPercent ?? null,
      fitsLike: data.fitsLike ?? null,
    };
  }

  const CONFIDENCE_TEXT = {
    high: 'High confidence',
    medium: 'Medium confidence',
    low: 'Low confidence',
  };

  /**
   * What the result card shows. The size, confidence, verdict and notes are the engine's words and numbers; this
   * only chooses how to present them. `names` maps owned-shirt ids back to what the visitor called them.
   */
  function describeResult(rec, names) {
    const hasSize = typeof rec.size === 'string' && rec.size !== '';
    const known = names && Object.prototype.hasOwnProperty.call(names, rec.fitsLike) ? names[rec.fitsLike] : null;
    const fitsLike = rec.fitsLike ? known || rec.fitsLike.replace(/-/g, ' ') : null;
    return {
      hasSize,
      size: hasSize ? rec.size : null,
      // The engine's verdict is the headline ("Get the M, fits like your ..."). With no size there is nothing to
      // headline, so the verdict becomes the explanation under a plain title.
      title: hasSize ? rec.verdict : 'No size to suggest',
      detail: hasSize ? null : rec.verdict,
      confidence: rec.confidence,
      confidenceText: CONFIDENCE_TEXT[rec.confidence],
      lowConfidence: rec.confidence === 'low' || !hasSize,
      matchText: typeof rec.matchPercent === 'number' ? `${Math.round(rec.matchPercent)}% match` : 'unknown',
      fitsLike: fitsLike || 'unknown',
      notes: rec.notes,
    };
  }

  // ---- Talking to the API ----

  /**
   * Both calls resolve to { ok: true, data } or { ok: false, kind, status, message }; they never reject.
   * kind: network | timeout | bad_request | not_found | server | invalid_response
   * @param {{ fetchFn?: typeof fetch, baseUrl?: string, timeoutMs?: number }} [options]
   */
  function createClient(options) {
    const { fetchFn = (...args) => root.fetch(...args), baseUrl = '', timeoutMs = REQUEST_TIMEOUT_MS } = options || {};

    async function call(path, init, read) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        let response;
        try {
          response = await fetchFn(`${baseUrl}${path}`, { ...init, signal: controller ? controller.signal : undefined });
        } catch (error) {
          const aborted = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
          return { ok: false, kind: aborted ? 'timeout' : 'network', status: 0, message: '' };
        }
        let body = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        if (!response.ok) {
          const message = isObject(body) && typeof body.error === 'string' ? body.error.slice(0, MAX_ERROR_TEXT) : '';
          const kind = response.status === 400 ? 'bad_request' : response.status === 404 ? 'not_found' : 'server';
          return { ok: false, kind, status: response.status, message };
        }
        const data = read(body);
        if (data === null) return { ok: false, kind: 'invalid_response', status: response.status, message: '' };
        return { ok: true, data };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    return {
      loadCandidates: () => call('/api/candidates', { method: 'GET', headers: { Accept: 'application/json' } }, readCandidates),
      recommend: (wardrobe, candidateId) =>
        call(
          '/api/recommend',
          { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ wardrobe, candidateId }) },
          readRecommendation,
        ),
    };
  }

  /** What to tell the visitor when a call failed. The server's own message is shown only for a rejected request. */
  function describeError(error) {
    switch (error.kind) {
      case 'network':
        return 'Could not reach the size service. Check your connection and try again.';
      case 'timeout':
        return 'The size service took too long to answer. Try again.';
      case 'bad_request':
        return error.message ? `The size service did not accept that: ${error.message}` : 'The size service did not accept that request.';
      case 'not_found':
        return 'That product is no longer available. Pick another one.';
      case 'invalid_response':
        return 'The size service sent an answer this page could not read. Try again in a moment.';
      default:
        return 'The size service had a problem. Try again in a minute.';
    }
  }

  let started = false;

  const api = {
    DIMS, FIT_LABELS, MAX_SHIRTS, MAX_LIST, REQUEST_TIMEOUT_MS,
    parseMeasurement, slugify, buildWardrobe, parseUrl, matchCandidateByUrl, filterCandidates, chartRows,
    readCandidates, readRecommendation, describeResult, createClient, describeError,
  };

  if (typeof document !== 'undefined') root.addEventListener('DOMContentLoaded', () => initPage(api, root));
  if (typeof document !== 'undefined' && document.readyState !== 'loading') initPage(api, root);

  // ---- Page wiring ----

  function initPage(demo, win) {
    const form = document.getElementById('try-form');
    if (!form || started) return;
    started = true;

    const $ = (id) => document.getElementById(id);
    const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const track = (name, props) => win.PearfitAnalytics && win.PearfitAnalytics.track(name, props);
    const client = demo.createClient();

    const shirtsEl = $('try-shirts');
    const unitEl = $('try-unit');
    const resultEl = $('try-result');
    const submitEl = $('try-submit');
    const searchEl = $('try-search');
    const productEl = $('try-product');
    const urlEl = $('try-url');
    const pickStatusEl = $('try-pick-status');
    const retryEl = $('try-retry');
    const formErrorEl = $('try-form-error');

    let candidates = null; // null until loaded
    let loadState = 'idle'; // idle | loading | ready | failed
    let source = 'picked_candidate';
    let pending = false;
    let lastNames = {};
    let rowCount = 0;

    // --- shirt rows ---
    function rowHtml(values, number) {
      const v = values || {};
      const field = (key, label) =>
        `<label class="try-field">${label}<input type="text" inputmode="decimal" autocomplete="off" name="${key}" value="${esc(v[key] || '')}" placeholder="unknown" /></label>`;
      return `
        <fieldset class="try-shirt" data-row aria-describedby="try-row-${number}-error">
          <legend>Shirt <span data-number>${number}</span></legend>
          <div class="try-shirt-top">
            <label class="try-field try-field-wide">Name <input type="text" name="name" maxlength="40" autocomplete="off" value="${esc(v.name || '')}" placeholder="e.g. White Gap tee" /></label>
            <label class="try-field">How it fits you
              <select name="label">
                ${[['great', 'Fits great'], ['tight', 'Too tight'], ['loose', 'Too loose']].map(([value, text]) => `<option value="${value}"${(v.label || 'great') === value ? ' selected' : ''}>${text}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="try-shirt-dims">
            ${field('chest', 'Chest')}${field('length', 'Length')}${field('sleeve', 'Sleeve')}
          </div>
          <p class="try-error" id="try-row-${number}-error" data-row-error role="alert"></p>
          <button type="button" class="try-link" data-remove>Remove this shirt</button>
        </fieldset>`;
    }

    function renumber() {
      const rows = shirtsEl.querySelectorAll('[data-row]');
      rows.forEach((row, i) => {
        row.querySelector('[data-number]').textContent = String(i + 1);
        const remove = row.querySelector('[data-remove]');
        remove.hidden = rows.length === 1;
        remove.setAttribute('aria-label', `Remove shirt ${i + 1}`);
      });
      $('try-add').disabled = rows.length >= demo.MAX_SHIRTS;
    }

    function addRow(values) {
      rowCount += 1;
      shirtsEl.insertAdjacentHTML('beforeend', rowHtml(values, rowCount));
      renumber();
      return shirtsEl.lastElementChild;
    }

    function readRows() {
      return [...shirtsEl.querySelectorAll('[data-row]')].map((row) => {
        const get = (name) => row.querySelector(`[name="${name}"]`).value;
        return { name: get('name'), label: get('label'), chest: get('chest'), length: get('length'), sleeve: get('sleeve') };
      });
    }

    shirtsEl.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove]');
      if (!remove) return;
      const row = remove.closest('[data-row]');
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      renumber();
      if (next) next.querySelector('input').focus();
    });
    $('try-add').addEventListener('click', () => addRow().querySelector('input').focus());
    // The two example shirts are the documented sample wardrobe (engine/data/wardrobes/sample.json): one that fits
    // great with the sleeve not measured, one that is too loose.
    $('try-example').addEventListener('click', () => {
      shirtsEl.innerHTML = '';
      rowCount = 0;
      unitEl.value = 'cm';
      addRow({ name: 'White Gap tee', label: 'great', chest: '52.5', length: '70', sleeve: '' });
      addRow({ name: 'Grey Zara shirt', label: 'loose', chest: '57', length: '75', sleeve: '65' });
      formErrorEl.textContent = '';
      shirtsEl.querySelector('input').focus();
    });

    // --- product choice ---
    function setPickStatus(text, showRetry) {
      pickStatusEl.textContent = text;
      retryEl.hidden = !showRetry;
    }

    function showPicker(visible) {
      productEl.closest('label').hidden = !visible;
      searchEl.closest('label').hidden = !visible;
    }

    function renderProducts() {
      if (loadState === 'loading' || loadState === 'idle') {
        showPicker(true);
        productEl.innerHTML = '<option value="">Loading products…</option>';
        productEl.disabled = true;
        setPickStatus('Loading products…', false);
        return;
      }
      // With no list to choose from (the service failed, or has nothing yet) the empty dropdown is hidden and one
      // friendly line takes its place, with the retry button.
      if (loadState === 'failed' || candidates.length === 0) {
        showPicker(false);
        productEl.innerHTML = '<option value="">Products are loading, try again in a moment</option>';
        productEl.disabled = true;
        setPickStatus('Products are loading, try again in a moment.', true);
        return;
      }
      showPicker(true);
      const { shown, total } = demo.filterCandidates(candidates, searchEl.value);
      const previous = productEl.value;
      productEl.disabled = shown.length === 0;
      productEl.innerHTML =
        shown.length === 0
          ? '<option value="">No product matches</option>'
          : shown.map((c) => `<option value="${esc(c.id)}"${c.id === previous ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
      const word = total === 1 ? 'product' : 'products';
      setPickStatus(
        total > shown.length ? `Showing the first ${shown.length} of ${total} ${word}. Type to narrow the list.` : `${total} ${word} to choose from.`,
        false,
      );
    }

    let loadPromise = null;
    // One load at a time; callers that arrive during it wait for the same one.
    function loadCandidates() {
      if (loadState === 'ready') return Promise.resolve();
      if (loadPromise) return loadPromise;
      loadPromise = (async () => {
        loadState = 'loading';
        renderProducts();
        const startedAt = performance.now();
        const result = await client.loadCandidates();
        if (!result.ok) {
          loadState = 'failed';
          renderProducts();
          track('demo_failed', { source: 'candidate_list', reason: result.kind, status: result.status, duration_ms: Math.round(performance.now() - startedAt) });
          return;
        }
        candidates = result.data;
        loadState = 'ready';
        renderProducts();
      })().finally(() => {
        loadPromise = null;
      });
      return loadPromise;
    }

    retryEl.addEventListener('click', () => {
      loadState = 'idle';
      loadCandidates();
      productEl.focus();
    });
    searchEl.addEventListener('input', () => {
      if (loadState === 'ready') renderProducts();
    });

    function setSource(next) {
      source = next;
      document.querySelectorAll('#try-source button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === next)));
      $('try-pick').hidden = next !== 'picked_candidate';
      $('try-paste').hidden = next !== 'pasted_url';
      formErrorEl.textContent = '';
    }
    document.querySelectorAll('#try-source button').forEach((b) => b.addEventListener('click', () => setSource(b.dataset.source)));

    // Load the products when the demo is about to come into view (or is used first), not for every visitor.
    const lazyLoad = () => loadCandidates();
    if ('IntersectionObserver' in win) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          observer.disconnect();
          lazyLoad();
        },
        { rootMargin: '400px 0px' },
      );
      observer.observe(form);
    } else {
      lazyLoad();
    }
    form.addEventListener('focusin', lazyLoad);

    // --- result card ---
    function setResult(state, html) {
      resultEl.dataset.state = state;
      resultEl.setAttribute('aria-busy', String(state === 'loading'));
      resultEl.innerHTML = html;
    }

    function showIdle() {
      setResult('idle', '<p class="try-result-empty">Your answer appears here. It is worked out from your shirts and the product you pick.</p>');
    }

    function chartHtml(candidate, size) {
      const rows = demo.chartRows(candidate);
      return `
        <table class="try-chart">
          <caption>Size chart for ${esc(candidate.name)}, in cm</caption>
          <thead><tr><th scope="col">Size</th><th scope="col">Chest</th><th scope="col">Length</th><th scope="col">Sleeve</th></tr></thead>
          <tbody>
            ${rows.map((row) => `<tr${row.size === size ? ' class="is-pick" aria-current="true"' : ''}><th scope="row">${esc(row.size)}${row.size === size ? ' <span class="try-pick-tag">your size</span>' : ''}</th>${row.cells.map((cell) => `<td${cell === 'unknown' ? ' class="is-unknown"' : ''}>${esc(cell)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>`;
    }

    function showResult(rec, candidate) {
      const view = demo.describeResult(rec, lastNames);
      const lowNote = view.lowConfidence
        ? `<p class="try-low"><strong>${view.hasSize ? 'Low confidence.' : 'No answer.'}</strong> ${view.hasSize ? 'Treat this as a hint, not a recommendation. Adding another shirt that fits you great, or filling in a missing measurement, usually helps.' : 'There is not enough to compare. Add a shirt that fits you great and has the same measurements as this product.'}</p>`
        : '';
      setResult(
        view.lowConfidence ? 'low' : 'result',
        `
        <p class="try-result-product">${esc(candidate.name)}</p>
        <div class="try-result-top">
          ${view.hasSize ? `<span class="try-size" aria-hidden="true">${esc(view.size)}</span>` : ''}
          <p class="try-badge try-badge-${view.confidence}">${esc(view.confidenceText)}</p>
        </div>
        <h3 class="try-result-title" id="try-result-title">${esc(view.title)}</h3>
        ${view.detail ? `<p class="try-verdict">${esc(view.detail)}</p>` : ''}
        ${lowNote}
        <dl class="try-facts">
          <div><dt>Closest shirt you own</dt><dd>${esc(view.fitsLike)}</dd></div>
          <div><dt>Match for that size</dt><dd>${esc(view.matchText)}</dd></div>
        </dl>
        ${view.notes.length ? `<ul class="try-notes">${view.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${chartHtml(candidate, view.hasSize ? view.size : null)}
        <p class="try-foot">Confidence falls when two sizes are nearly tied, a measurement is missing, or the size lands close to a shirt you said did not fit.</p>`,
      );
    }

    function showFailure(message, extraHtml) {
      setResult('error', `<p class="try-result-error" role="alert">${esc(message)}</p>${extraHtml || ''}<button type="button" class="btn btn-ghost" id="try-again">Try again</button>`);
      $('try-again').addEventListener('click', () => form.requestSubmit());
    }

    // --- submit ---
    function showRowErrors(errors) {
      shirtsEl.querySelectorAll('[data-row-error]').forEach((el) => { el.textContent = ''; });
      const formLevel = [];
      let firstRow = null;
      for (const error of errors) {
        if (error.row === null) { formLevel.push(error.message); continue; }
        const row = shirtsEl.querySelectorAll('[data-row]')[error.row];
        const slot = row.querySelector('[data-row-error]');
        slot.textContent = slot.textContent ? `${slot.textContent} ${error.message}` : error.message;
        if (!firstRow) firstRow = row;
      }
      formErrorEl.textContent = formLevel.join(' ');
      return firstRow;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (pending) return;
      showRowErrors([]);

      const built = demo.buildWardrobe(readRows(), unitEl.value);
      if (!built.ok) {
        const firstRow = showRowErrors(built.errors);
        (firstRow ? firstRow.querySelector('input, select') : formErrorEl).focus();
        return;
      }
      lastNames = built.names;

      // Which product? A pick comes straight from the list; a link must match one in the list.
      let candidate = null;
      let host = null;
      if (source === 'picked_candidate') {
        if (loadState !== 'ready') {
          formErrorEl.textContent = loadState === 'failed' ? 'The product list could not be loaded. Use "Try again" above the list.' : 'The product list is still loading.';
          return;
        }
        candidate = candidates.find((c) => c.id === productEl.value) || null;
        if (!candidate) {
          formErrorEl.textContent = 'Pick a product from the list.';
          productEl.focus();
          return;
        }
      } else {
        if (loadState !== 'ready') await loadCandidates();
        if (loadState !== 'ready') {
          formErrorEl.textContent = 'The product list could not be loaded, so a link cannot be matched. Try again in a moment.';
          return;
        }
        const match = demo.matchCandidateByUrl(urlEl.value, candidates);
        host = match.host;
        if (!match.ok && match.reason === 'not_a_url') {
          formErrorEl.textContent = 'Paste a product link, like https://www.example.com/products/123.';
          urlEl.focus();
          return;
        }
        if (!match.ok) {
          track('demo_started', { source, host, wardrobe_size: built.wardrobe.length });
          track('demo_failed', { source, host, reason: 'no_match', duration_ms: 0 });
          setResult(
            'error',
            `<p class="try-result-error" role="alert">We have not read a product at ${esc(host)} that matches this link yet.</p>
             <p>This page can only size products we have already read. Pick one of the products in the list instead.</p>`,
          );
          resultEl.focus();
          return;
        }
        candidate = match.candidate;
      }

      formErrorEl.textContent = '';
      pending = true;
      submitEl.disabled = true;
      submitEl.textContent = 'Working out your size…';
      setResult('loading', '<p class="try-result-empty">Comparing your shirts with this product…</p>');
      const props = { source, host, candidate_id: candidate.id, wardrobe_size: built.wardrobe.length };
      track('demo_started', props);
      const startedAt = performance.now();
      const result = await client.recommend(built.wardrobe, candidate.id);
      const duration_ms = Math.round(performance.now() - startedAt);
      pending = false;
      submitEl.disabled = false;
      submitEl.textContent = 'Get my size';

      if (!result.ok) {
        showFailure(demo.describeError(result));
        track('demo_failed', { source, host, candidate_id: candidate.id, reason: result.kind, status: result.status, duration_ms });
      } else {
        showResult(result.data, candidate);
        track('demo_completed', {
          source, host, candidate_id: candidate.id, wardrobe_size: built.wardrobe.length,
          size: result.data.size, confidence: result.data.confidence, has_fits_like: result.data.fitsLike !== null, duration_ms,
        });
      }
      resultEl.focus();
    });

    addRow();
    setSource('picked_candidate');
    renderProducts();
    showIdle();
  }

  return api;
});
