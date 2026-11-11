/** Scripts that run inside the rendered page (review widgets, paging, sorting, scrolling, serializing). */
import { REVIEW_CARD_SELECTOR, REVIEW_WIDGET_SELECTOR } from './constants.ts';

/**
 * In-page helper: querySelectorAll that also searches open shadow roots (Bazaarvoice's newer
 * review app renders inside one). Prepended to the in-page scripts below.
 */
export const DEEP_QUERY = `const deepAll = (selector, root = document) => {
  const out = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepAll(selector, el.shadowRoot));
  return out;
};`;

/**
 * Clicks the rating summary near the product title ("4.1 out of 5 (84)", "84 reviews") when it is a
 * same-page control. On many stores it opens the review section (Arc'teryx loads Bazaarvoice from it).
 */
export const OPEN_RATING_SUMMARY = `(() => {
  ${DEEP_QUERY}
  for (const el of deepAll('a, button, [role="button"]')) {
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (label.length > 90 || !/out of 5[^a-z]*\\(?\\d|out of 5\\b.*\\b\\d[\\d,]* (reviews?|ratings?)\\b|\\(\\d[\\d,]*\\)|^\\d[\\d,]* (reviews?|ratings?)\\b/i.test(label)) continue;
    const href = el.getAttribute('href') || '';
    if (el.tagName === 'A' && href && !/^(#|javascript:)/i.test(href)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    el.click();
    return label.slice(0, 40);
  }
  return '';
})()`;

/**
 * A numbered pager that replaces the review cards on the page (Halara: buttons labelled "Page 1", "Page 2",
 * the current one marked aria-current="page"). Clicks the next number and returns its label, or '' when
 * the current page is the last one or no such pager exists. Buttons only; never a link that leaves the page.
 */
export const CLICK_NEXT_NUMBERED_PAGE = `(() => {
  ${DEEP_QUERY}
  const label = (el) => (el.getAttribute('aria-label') || '').trim();
  const pages = deepAll('button, [role="button"]').filter((el) => /^page \\d+$/i.test(label(el)));
  const current = pages.find((el) => el.getAttribute('aria-current') === 'page');
  if (!current) {
    // Salesforce storefronts: <div class="page-numbers"><div class="page-number active" data-page="1">…
    const active = deepAll('.page-numbers .page-number.active[data-page]')[0];
    const nextDiv = active && active.nextElementSibling;
    if (!nextDiv || !nextDiv.getAttribute('data-page')) return '';
    nextDiv.click();
    return 'Page ' + nextDiv.getAttribute('data-page');
  }
  const n = Number(label(current).replace(/\\D+/g, ''));
  const next = pages.find((el) => label(el).toLowerCase() === 'page ' + (n + 1));
  if (!next) return '';
  next.click();
  return label(next);
})()`;

/** The review cards currently on the page, as markup: a small snapshot of one page of a replacing pager. */
export const REVIEW_CARDS_MARKUP = `(() => {
  ${DEEP_QUERY}
  // A wrapper that holds another match is skipped, as the reader does, so a card and its child are not both collected.
  const cards = deepAll(${JSON.stringify(REVIEW_CARD_SELECTOR)});
  return '<div>' + cards.filter((el) => !cards.some((other) => other !== el && el.contains(other))).map((el) => el.outerHTML).join('') + '</div>';
})()`;

/**
 * Opens a "Reviews" or "Reviews (13)" heading that is a clickable text and not a tab, button or link
 * (an Alpine/JS accordion built from spans). Used only when no review card is showing. Returns the label.
 */
export const OPEN_REVIEWS_HEADING = `(() => {
  ${DEEP_QUERY}
  const showing = deepAll(${JSON.stringify(REVIEW_CARD_SELECTOR)}).some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (showing) return '';
  for (const el of deepAll('span, div, li, h2, h3, h4, p')) {
    if (el.closest('a, button, [role="tab"]') || el.children.length > 3) continue;
    const label = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!/^(customer )?reviews?( ?\\(\\d[\\d,]*\\))?$/i.test(label)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || window.getComputedStyle(el).cursor !== 'pointer') continue;
    el.click();
    return label;
  }
  return '';
})()`;

/**
 * The address of this product's own review page ("See Reviews" → /t/product/reviews): a link whose path
 * extends the product page's path. Never another product or section of the site.
 */
export const ALL_REVIEWS_LINK = `(() => {
  ${DEEP_QUERY}
  const base = location.pathname.replace(/\\/$/, '');
  for (const el of deepAll('a[href]')) {
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!/^(see|view|read|show)( all)?( \\d[\\d,]*)? reviews?\\b|^all reviews\\b/i.test(label)) continue;
    try {
      const target = new URL(el.getAttribute('href'), location.href);
      if (target.origin === location.origin && target.pathname.startsWith(base + '/') && /review/i.test(target.pathname)) return target.href;
    } catch (e) {}
  }
  return '';
})()`;

/**
 * The next page of a review list that pages by link: /…/page/3 after /…/page/2, or ?page=3. Only on a
 * review page (its path names reviews), only within the same list, never another product or a search.
 */
export const NEXT_REVIEW_PAGE_LINK = `(() => {
  if (!/review/i.test(location.pathname)) return '';
  const pageOf = (u) => Number((u.pathname.match(/\\/page\\/(\\d+)\\/?$/) || [])[1] || (u.search.match(/[?&](?:page|pg)=(\\d+)/) || [])[1] || 1);
  const base = location.pathname.replace(/\\/page\\/\\d+\\/?$/, '').replace(/\\/$/, '');
  // The other query parameters (a star filter, another sort) must match, or the link is another list.
  const otherParams = (u) => {
    const params = new URLSearchParams(u.search);
    params.delete('page');
    params.delete('pg');
    params.sort();
    return params.toString();
  };
  const here = new URL(location.href);
  const current = pageOf(here);
  for (const a of document.querySelectorAll('a[href]')) {
    let target;
    try { target = new URL(a.getAttribute('href'), location.href); } catch (e) { continue; }
    if (target.origin !== location.origin) continue;
    const samePath = target.pathname.replace(/\\/page\\/\\d+\\/?$/, '').replace(/\\/$/, '') === base;
    if (samePath && otherParams(target) === otherParams(here) && pageOf(target) === current + 1) return target.href;
  }
  return '';
})()`;

/** Scrolls down until the page stops growing (lazy sections load as they come into view). */
export const SCROLL_TO_END = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
  let y = 0;
  let stable = 0;
  let lastHeight = 0;
  const started = Date.now();
  while (y < 80000 && Date.now() - started < 15000) {
    y += step;
    window.scrollTo(0, y);
    await sleep(120);
    const height = document.documentElement.scrollHeight;
    if (y + window.innerHeight >= height) {
      stable = height === lastHeight ? stable + 1 : 0;
      lastHeight = height;
      if (stable >= 3) break;
      await sleep(400);
    }
  }
})()`;

export const SCROLL_TO_BOTTOM = `(() => { window.scrollTo(0, document.documentElement.scrollHeight); return 'scroll'; })()`;

/** Brings each review widget into view so widgets that load on visibility start loading. */
export const REVIEW_WIDGETS_INTO_VIEW = `(async () => {
  ${DEEP_QUERY}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = [];
  for (const el of deepAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)})) {
    if (seen.some((s) => s.contains(el))) continue;
    seen.push(el);
    el.scrollIntoView({ block: 'center' });
    await sleep(350);
    if (seen.length >= 12) break;
  }
  return seen.length;
})()`;

/**
 * Clicks one "load more" or "next page" control inside a review widget. Never a link that would
 * leave the page. Returns the control's label, or '' when there is none.
 */
export const CLICK_NEXT_REVIEWS = `((skip) => {
  ${DEEP_QUERY}
  // "Read more" expands one review's text; it never loads more reviews.
  const MORE = /^(load|show|see|view) (more|all|\\d+ more)( reviews?)?$|^more reviews$/i;
  const NEXT = /^(next|next page|next reviews?|›|»|→|>|go to next page)$/i;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const disabled = (el) =>
    el.disabled || el.getAttribute('aria-disabled') === 'true' || /(^|\\s)(is-)?disabled(\\s|$)/.test(String(el.className || ''));
  const seen = new Set();
  const found = [];
  for (const box of deepAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)})) {
    for (const el of deepAll('button, a, [role="button"], [role="link"]', box)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const aria = el.getAttribute('aria-label') || '';
      // Decoration around the words: "+ Load More Reviews", "Load More Reviews (73 remaining)".
      const label = (aria || el.textContent || el.getAttribute('title') || '')
        .replace(/\\s+/g, ' ')
        .trim()
        .replace(/^[^a-z0-9›»→>]+/i, '')
        // Only a count of what is left: "See all (12)" (customer photos) must not become "See all".
        .replace(/\\s*\\(\\d[\\d,]* (remaining|more|left)\\)$/i, '');
      if (/about this review|this review'?s? (text|content)/i.test(aria)) continue;
      const isMore = MORE.test(label);
      const isNext = NEXT.test(label) || /next (page|reviews?)/i.test(aria) || (/(^|[-_ ])next([-_ ]|$)/i.test(String(el.className || '')) && label.length <= 3);
      if (!isMore && !isNext) continue;
      if (el.tagName === 'A') {
        // Same-page links only: "#…", "javascript:…", "?…" (Okendo's ?okeReviewsNextUrl=…), or this page's
        // own path with other parameters (Bazaarvoice's "Next Reviews" links to ?bvstate=pg:2).
        const href = el.getAttribute('href') || '';
        if (href && !/^(#|javascript:|\\?)/i.test(href)) {
          let same = false;
          try {
            const target = new URL(href, location.href);
            same = target.origin === location.origin && target.pathname === location.pathname;
          } catch (e) {}
          if (!same) continue;
        }
      }
      // A "next" beside numbered page buttons is the review list's pager, not a picture slider.
      const pager = isNext && el.parentElement && [...el.parentElement.querySelectorAll('button, a, [role="button"]')]
        .some((b) => /^(page )?\\d+$/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
      // Other arrows inside a photo carousel or slider are not review paging.
      if (isNext && !isMore && !pager && el.closest('[class*="carousel" i], [class*="slider" i], [class*="swiper" i], [class*="slick" i], [class*="gallery" i], [class*="media" i]')) continue;
      if (!visible(el) || disabled(el)) continue;
      found.push({ el, isMore, label, rank: isMore ? 3 : pager ? 2 : 1 });
    }
  }
  // Fallback: a "load more reviews" button that sits outside the widget (buttons only, never links).
  if (found.length === 0) {
    for (const el of deepAll('button, [role="button"]')) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (/^(load|show|see|view) more( reviews?)?$/i.test(label) && visible(el) && !disabled(el)) {
        found.push({ el, isMore: true, label, rank: 3 });
        break;
      }
    }
  }
  // A pager outside the widget whose numbered buttons name the reviews ("Go to reviews page 2"): its
  // "next" button pages the review list. Only a pager that says "reviews" counts, not a product grid's.
  if (found.length === 0) {
    for (const marker of deepAll('button, [role="button"]')) {
      if (!/^go to reviews? page \\d+$/i.test((marker.getAttribute('aria-label') || '').trim())) continue;
      for (const el of deepAll('button, [role="button"]', marker.parentElement || document)) {
        const aria = el.getAttribute('aria-label') || '';
        const label = (aria || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!(NEXT.test(label) || /next (page|reviews?)/i.test(aria))) continue;
        if (visible(el) && !disabled(el)) found.push({ el, isMore: false, label, rank: 2 });
      }
      if (found.length > 0) break;
    }
  }
  // A control that loaded nothing last time is skipped, so the next candidate gets a turn.
  const pick = found.filter((f) => !skip.includes(f.label.slice(0, 40) || 'next')).sort((a, b) => b.rank - a.rank)[0];
  if (!pick) return '';
  // Mark it, so a real pointer click can be sent to the same control if this script click does nothing.
  for (const el of deepAll('[data-pearfit-paging]')) el.removeAttribute('data-pearfit-paging');
  pick.el.setAttribute('data-pearfit-paging', '1');
  pick.el.scrollIntoView({ block: 'center' });
  pick.el.click();
  return pick.label.slice(0, 40) || 'next';
})`;

/**
 * Sorts a review widget by newest first, when it offers that. Widgets often open on "most helpful"
 * or "highest rated", so the first pages are a biased sample. Returns what it did, or ''.
 * Step "select": a <select> with a newest option. Step "open": clicks a "Sort" control; step
 * "pick" (run after a short wait) clicks the newest option of the menu it opened.
 */
export const SORT_NEWEST = `((step) => {
  ${DEEP_QUERY}
  const NEWEST = /^(sort( by)?:?\\s*)?(most recent|newest( first| to oldest)?|date,? newest( first)?|date \\(newest\\)|recent|latest)$/i;
  const boxes = deepAll(${JSON.stringify(REVIEW_WIDGET_SELECTOR)});
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const text = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
  if (step === 'select') {
    for (const box of boxes) {
      for (const select of deepAll('select', box)) {
        const option = [...select.options].find((o) => NEWEST.test(o.textContent.trim()));
        if (!option || select.value === option.value) continue;
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return 'select:' + option.textContent.trim();
      }
    }
    return '';
  }
  if (step === 'open') {
    for (const box of boxes) {
      for (const el of deepAll('button, [role="button"], [role="combobox"], [aria-haspopup]', box)) {
        if (/^sort\\b|sort by/i.test(text(el)) && visible(el)) { el.click(); return 'open:' + text(el).slice(0, 30); }
      }
    }
    return '';
  }
  for (const el of deepAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, a[href^="#"], a:not([href])')) {
    if (NEWEST.test(text(el)) && visible(el) && el.getAttribute('aria-selected') !== 'true') { el.click(); return 'pick:' + text(el); }
  }
  return '';
})`;

export const SERIALIZE_WITH_SHADOW_ROOTS = `(() => {
  const parts = [];
  const walk = (root) => {
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) {
        parts.push(el.shadowRoot.innerHTML);
        walk(el.shadowRoot);
      }
    });
  };
  walk(document);
  const html = document.documentElement.outerHTML;
  if (parts.length === 0) return '<!DOCTYPE html>' + html;
  const dump = '<div data-shadow-root-dump>' + parts.join('\\n') + '</div>';
  const idx = html.lastIndexOf('</body>');
  return '<!DOCTYPE html>' + (idx === -1 ? html + dump : html.slice(0, idx) + dump + html.slice(idx));
})()`;

/** Clicks the review iframe's own "Show more reviews" / "Load more" button; returns its label or ''. */
export const CLICK_FRAME_LOAD_MORE = `(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /^(show|load|see|view) more( reviews?)?$/i.test((b.textContent || '').trim()) && b.getBoundingClientRect().width > 0 && !b.disabled);
  if (!btn) return '';
  btn.click();
  return (btn.textContent || '').trim();
})()`;
