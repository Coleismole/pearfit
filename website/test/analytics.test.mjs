import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// analytics.js is a plain browser script that also exports itself for Node. In Node it has no document, so it
// installs no listeners; the tests drive markReady and markUnavailable directly.
const analytics = createRequire(import.meta.url)('../analytics.js');
const { track, log, hostOf, sanitize, markReady, markUnavailable, reset, EVENTS, MAX_QUEUE } = analytics;

function fakePostHog() {
  const calls = [];
  globalThis.posthog = {
    capture: (name, props) => calls.push([name, props]),
    logger: { info: (message, attributes) => calls.push(['log:info', message, attributes]) },
  };
  return calls;
}

test.beforeEach(() => {
  reset();
  delete globalThis.posthog;
});

test('hostOf keeps only the hostname, without www or path, query and credentials', () => {
  assert.equal(hostOf('https://www.uniqlo.com/ca/en/products/E123?colorDisplayCode=09'), 'uniqlo.com');
  assert.equal(hostOf('https://Shop.Example.COM/p/1'), 'shop.example.com');
  assert.equal(hostOf('uniqlo.com/products/x'), 'uniqlo.com');
  assert.equal(hostOf('https://me:hunter2@hm.com/p'), 'hm.com');
  assert.equal(hostOf('  www.zara.com  '), 'zara.com');
});

test('hostOf returns null for anything that is not a web address', () => {
  for (const value of ['not a url', 'javascript:alert(1)', 'ftp://files.example.com/a', 'localhost', '', '   ', null, undefined, 42, {}]) {
    assert.equal(hostOf(value), null, String(value));
  }
});

test('sanitize keeps only the properties listed for the event', () => {
  const props = sanitize('fit_recommendation_explored', { interaction: 'usual_size_picker', usual_size: 'L', recommended_size: 'M', secret: 'x', email: 'a@b.com' });
  assert.deepEqual(props, { interaction: 'usual_size_picker', usual_size: 'L', recommended_size: 'M' });
});

test('sanitize drops an unknown event', () => {
  assert.equal(sanitize('page_viewed', {}), null);
  assert.equal(sanitize('__proto__', {}), null);
  assert.equal(sanitize('toString', {}), null);
});

test('sanitize drops URLs and email addresses even in an allowed property', () => {
  const props = sanitize('fit_recommendation_explored', {
    interaction: 'https://www.cos.com/product/secret-path',
    usual_size: 'alex@example.com tried it',
    recommended_size: 'M',
  });
  assert.deepEqual(props, { recommended_size: 'M' });
});

test('sanitize only passes plain values: finite numbers, booleans, null and short strings', () => {
  const props = sanitize('fit_recommendation_explored', {
    interaction: 'a'.repeat(200),
    usual_size: null,
    recommended_size: { nested: 'object' },
  });
  assert.deepEqual(props, { interaction: 'a'.repeat(80), usual_size: null });
  assert.deepEqual(sanitize('fit_size_inspected', { product_id: () => 'fn', selected_size: Number.NaN }), {});
  assert.deepEqual(sanitize('fit_size_inspected', { product_id: 7, selected_size: true }), { product_id: 7, selected_size: true });
});

test('demo events carry the host and counts, never what the visitor typed', () => {
  const props = sanitize('demo_completed', {
    source: 'pasted_url',
    host: 'uniqlo.com',
    candidate_id: 'e483970-000',
    wardrobe_size: 2,
    size: 'M',
    confidence: 'high',
    has_fits_like: true,
    duration_ms: 212,
    shirt_names: ['White Gap tee'],
    measurements: { chest_cm: 52.5 },
    url: 'https://www.uniqlo.com/ca/en/products/E483970-000/00?token=abc',
    wardrobe: [{ id: 'white-gap-tee' }],
  });
  assert.deepEqual(props, {
    source: 'pasted_url', host: 'uniqlo.com', candidate_id: 'e483970-000', wardrobe_size: 2,
    size: 'M', confidence: 'high', has_fits_like: true, duration_ms: 212,
  });
  const failed = sanitize('demo_failed', { source: 'candidate_list', reason: 'server', status: 502, error: 'Supabase HTTP 401 secret', message: 'x' });
  assert.deepEqual(failed, { source: 'candidate_list', reason: 'server', status: 502 });
});

test('sanitize copes with missing or odd props', () => {
  assert.deepEqual(sanitize('section_viewed'), {});
  assert.deepEqual(sanitize('section_viewed', null), {});
  assert.deepEqual(sanitize('section_viewed', 'hero'), {});
});

test('track does nothing and does not throw when PostHog never loads', () => {
  assert.equal(track('section_viewed', { section: 'hero' }), true, 'queued while waiting');
  markUnavailable();
  assert.equal(track('section_viewed', { section: 'faq' }), false, 'dropped once PostHog is known to be missing');
  assert.doesNotThrow(() => log('info', 'hello', {}));
});

test('track queues until PostHog is ready, then sends in order', () => {
  const calls = fakePostHog();
  track('section_viewed', { section: 'hero' });
  track('scraper_link_clicked', { location: 'header' });
  assert.equal(calls.length, 0);
  markReady();
  assert.deepEqual(calls, [
    ['section_viewed', { section: 'hero' }],
    ['scraper_link_clicked', { location: 'header' }],
  ]);
  track('section_viewed', { section: 'faq' });
  assert.equal(calls.length, 3);
});

test('queued events are discarded when PostHog turns out to be blocked', () => {
  const calls = fakePostHog();
  track('section_viewed', { section: 'hero' });
  markUnavailable();
  // PostHog never starts, so nothing is ever flushed; a late start would find an empty queue.
  markReady();
  assert.equal(calls.length, 0);
});

test('the queue is capped', () => {
  const calls = fakePostHog();
  for (let i = 0; i < MAX_QUEUE + 20; i += 1) track('section_viewed', { section: `s${i}` });
  markReady();
  assert.equal(calls.length, MAX_QUEUE);
});

test('a PostHog that throws does not break the page', () => {
  globalThis.posthog = {
    capture: () => {
      throw new Error('blocked by a content blocker');
    },
  };
  markReady();
  assert.equal(track('section_viewed', { section: 'hero' }), false);
  assert.doesNotThrow(() => track('section_viewed', { section: 'hero' }));
});

test('a queued event that throws on flush does not stop the rest', () => {
  const calls = [];
  let first = true;
  globalThis.posthog = {
    capture: (name, props) => {
      if (first) {
        first = false;
        throw new Error('first call fails');
      }
      calls.push([name, props]);
    },
  };
  track('section_viewed', { section: 'a' });
  track('section_viewed', { section: 'b' });
  assert.doesNotThrow(() => markReady());
  assert.deepEqual(calls, [['section_viewed', { section: 'b' }]]);
});

test('track with a missing client after ready returns false instead of throwing', () => {
  markReady();
  assert.equal(track('section_viewed', { section: 'hero' }), false);
});

test('an unknown event is dropped and never reaches PostHog', () => {
  const calls = fakePostHog();
  markReady();
  assert.equal(track('made_up_event', { a: 1 }), false);
  assert.equal(calls.length, 0);
});

test('every event name is snake_case and every property name is snake_case', () => {
  for (const [name, props] of Object.entries(EVENTS)) {
    assert.match(name, /^[a-z]+(_[a-z]+)+$/, name);
    for (const prop of props) assert.match(prop, /^[a-z]+(_[a-z]+)*$/, `${name}.${prop}`);
  }
});

test('no event can carry free text a visitor typed', () => {
  const forbidden = ['url', 'query', 'text', 'review', 'message', 'email', 'name', 'error'];
  for (const [name, props] of Object.entries(EVENTS)) {
    for (const prop of props) {
      assert.ok(!forbidden.some((word) => prop === word), `${name} has a "${prop}" property`);
    }
  }
});
