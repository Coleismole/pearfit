// Where pilot and investor requests are sent.
const INQUIRY_INBOX = 'customerservice@pearfit.app';

// Illustrative per-size review split for one sample SKU (percent of reviews).
const SAMPLE_SIZES = [
  { size: 'XS', reviews: 14, small: 7, tts: 43, large: 50 },
  { size: 'S', reviews: 31, small: 6, tts: 52, large: 42 },
  { size: 'M', reviews: 48, small: 10, tts: 71, large: 19 },
  { size: 'L', reviews: 37, small: 5, tts: 41, large: 54 },
  { size: 'XL', reviews: 22, small: 9, tts: 36, large: 55 },
  { size: 'XXL', reviews: 6, small: 17, tts: 66, large: 17 },
];

const SIZE_UP_AT = -0.3;
const SIZE_DOWN_AT = 0.35;

const fmtInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmtUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Events go through analytics.js (window.PearfitAnalytics), which allow-lists them, queues until PostHog has
// started and does nothing when it never does. If that script is missing, these still do nothing instead of throwing.
function capture(event, properties) {
  window.PearfitAnalytics?.track(event, properties);
}

function logPostHog(level, message, attributes) {
  window.PearfitAnalytics?.log(level, message, attributes);
}

// Audience Bento Filter
function initStakeholderTabs() {
  const tabsHost = document.getElementById('stakeholder-tabs');
  const cards = document.querySelectorAll('#bento-grid .bento-card');
  tabsHost.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      capture('stakeholder_audience_selected', { audience: filter });
      tabsHost.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      cards.forEach((card) => {
        const aud = card.dataset.audience;
        if (filter === 'all' || aud === filter) {
          card.style.display = '';
          if (aud === 'shoppers') {
            card.classList.toggle('bento-span-2', filter === 'shoppers');
          }
        } else {
          card.style.display = 'none';
        }
      });
    });
  });
}

// Fit Insights Matrix Demo
const skewOf = (row) => (row.large - row.small) / 100;

function verdictFor(skew) {
  if (skew <= -0.35) return 'Runs small';
  if (skew <= -0.15) return 'Slightly small';
  if (skew < 0.15) return 'True to size';
  if (skew < 0.35) return 'Slightly large';
  return 'Runs large';
}

function recommend(usualIdx) {
  const row = SAMPLE_SIZES[usualIdx];
  const skew = skewOf(row);
  let idx = usualIdx;
  if (skew <= SIZE_UP_AT) idx = Math.min(SAMPLE_SIZES.length - 1, usualIdx + 1);
  else if (skew >= SIZE_DOWN_AT) idx = Math.max(0, usualIdx - 1);
  const confidence = Math.min(96, Math.max(72, Math.round(78 + Math.abs(skew) * 18 + row.reviews * 0.3)));
  return { row, skew, recommended: SAMPLE_SIZES[idx].size, moved: idx - usualIdx, confidence };
}

let activeIdx = 2;

function renderMatrix() {
  const host = document.getElementById('matrix-rows');
  host.innerHTML = SAMPLE_SIZES.map(
    (r, i) => `
    <div class="mrow${i === activeIdx ? ' active' : ''}" role="button" tabindex="0" aria-pressed="${i === activeIdx}" data-i="${i}">
      <span class="msize">${r.size}</span>
      <div class="mbar" role="img" aria-label="${r.size}: ${r.small}% runs small, ${r.tts}% true to size, ${r.large}% runs large">
        <span class="s" style="width:${r.small}%"></span><span class="t" style="width:${r.tts}%"></span><span class="l" style="width:${r.large}%"></span>
      </div>
      <span class="mverdict">${verdictFor(skewOf(r))}<small>${r.reviews} reviews</small></span>
    </div>`
  ).join('');

  host.querySelectorAll('.mrow').forEach((rowEl) => {
    const selectRow = () => {
      activeIdx = Number(rowEl.dataset.i);
      capture('fit_recommendation_explored', {
        interaction: 'fit_matrix',
        usual_size: SAMPLE_SIZES[activeIdx].size,
        recommended_size: recommend(activeIdx).recommended,
      });
      renderUsual();
      renderMatrix();
      renderReco();
      host.querySelector(`.mrow[data-i="${activeIdx}"]`)?.focus();
    };
    rowEl.addEventListener('click', selectRow);
    rowEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectRow();
    });
  });
}

function renderReco() {
  const { row, skew, recommended, moved, confidence } = recommend(activeIdx);
  const action = moved > 0 ? 'size up' : moved < 0 ? 'size down' : 'stay true to size';
  const sign = skew > 0 ? '+' : '';
  document.getElementById('reco').innerHTML = `
    <h3>Usually ${row.size} → this sample suggests ${recommended}</h3>
    <p><span class="conf">${confidence}% confidence</span> · Shopper guidance: <strong>${action}</strong></p>
    <p>In size ${row.size}, ${row.large}% of ${row.reviews} verified reviewers report it runs large while ${row.small}% report small (net fit index ${sign}${skew.toFixed(2)}).</p>`;
}

function renderUsual() {
  const host = document.getElementById('usual-size');
  host.innerHTML = SAMPLE_SIZES.map(
    (r, i) => `<button type="button" aria-pressed="${i === activeIdx}" data-i="${i}">${r.size}</button>`
  ).join('');
  host.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      activeIdx = Number(b.dataset.i);
      capture('fit_recommendation_explored', {
        interaction: 'usual_size_picker',
        usual_size: SAMPLE_SIZES[activeIdx].size,
        recommended_size: recommend(activeIdx).recommended,
      });
      renderUsual();
      renderMatrix();
      renderReco();
      host.querySelector(`[data-i="${activeIdx}"]`).focus();
    })
  );
}

// ROI Calculator with Exact Integer Reconciliation & Bracketing Tax
function renderRoi() {
  const f = document.getElementById('roi-form');
  const n = (name) => Math.max(0, Number(f.elements[name].value) || 0);
  const orders = n('orders');
  const aov = n('aov');
  const returnRate = Math.min(n('returnRate'), 100) / 100;
  const fitShare = Math.min(n('fitShare'), 100) / 100;
  const bracketingPct = Math.min(n('bracketingShare'), 100);
  const bracketingShare = bracketingPct / 100;
  const cost = n('cost');
  const reductionPct = n('reduction');
  const reduction = reductionPct / 100;

  const fitReturnsYear = Math.round(orders * 12 * returnRate * fitShare);
  const avoided = Math.round(fitReturnsYear * reduction);
  const savedUsd = avoided * cost;

  const annualBracketingOrders = Math.round(fitReturnsYear * bracketingShare);
  const bracketingReturnsAvoided = Math.round(avoided * bracketingShare);
  const singleItemReturnsAvoided = Math.max(0, avoided - bracketingReturnsAvoided);

  const bracketingLogisticsSavedUsd = bracketingReturnsAvoided * cost;
  const singleItemLogisticsSavedUsd = singleItemReturnsAvoided * cost;
  const bracketingBaselineDrainUsd = annualBracketingOrders * cost;

  const retainedGmvUsd = Math.round(avoided * aov * 0.45);
  const totalAnnualImpactUsd = savedUsd + retainedGmvUsd;

  document.getElementById('reduction-out').textContent = `${reductionPct}%`;
  document.getElementById('roi-returns').textContent = fmtInt.format(avoided);
  document.getElementById('roi-saved').textContent = fmtUsd.format(savedUsd);
  document.getElementById('roi-total').textContent = fmtUsd.format(totalAnnualImpactUsd);

  document.getElementById('bracketing-title').textContent =
    `The “Bracketing Tax” Breakdown (${bracketingPct}% multi-size carts)`;
  document.getElementById('bracketing-drain').textContent =
    `${fmtUsd.format(bracketingBaselineDrainUsd)}/yr baseline bracketing fees`;
  document.getElementById('b-multi-bar').style.width = `${bracketingPct}%`;
  document.getElementById('b-single-bar').style.width = `${100 - bracketingPct}%`;
  document.getElementById('bracketing-avoided-text').textContent =
    `Bracketing avoided: ${fmtInt.format(bracketingReturnsAvoided)} (${fmtUsd.format(bracketingLogisticsSavedUsd)} saved)`;
  document.getElementById('single-avoided-text').textContent =
    `Single-item avoided: ${fmtInt.format(singleItemReturnsAvoided)} (${fmtUsd.format(singleItemLogisticsSavedUsd)} saved)`;

  document.getElementById('roi-foot').textContent =
    `Your model: ${fmtInt.format(avoided)} avoided returns × $${cost} logistics fee = ${fmtUsd.format(savedUsd)} processing saved, plus ${fmtUsd.format(retainedGmvUsd)} if 45% of those shoppers keep the order instead of refunding. The reduction rate and the 45% share are assumptions in this calculator.`;
}

// Inquiry Mode Switch (Brand Pilot vs Investor Relations)
let inquiryMode = 'pilot';

function setInquiryMode(mode) {
  inquiryMode = mode;
  capture('inquiry_mode_selected', { inquiry_mode: inquiryMode });
  document.querySelectorAll('#inquiry-tabs button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });

  document.getElementById('pilot-heading').textContent =
    mode === 'pilot'
      ? 'Start a 6-week pilot on one category'
      : 'Connect with the Pearfit founding team';

  document.getElementById('store-label-text').textContent =
    mode === 'pilot' ? 'Storefront URL' : 'Firm or Organization';
  const storeInput = document.getElementById('pilot-store-input');
  if (mode === 'pilot') {
    storeInput.type = 'url';
    storeInput.placeholder = 'https://';
  } else {
    storeInput.type = 'text';
    storeInput.placeholder = 'Firm name or https://';
  }
  document.getElementById('volume-label-text').textContent =
    mode === 'pilot' ? 'Monthly order volume' : 'Primary interest';

  const selectEl = document.getElementById('pilot-volume-select');
  if (mode === 'pilot') {
    selectEl.innerHTML = `
      <option value="Under 1,000">Under 1,000 orders / mo</option>
      <option value="1,000 – 10,000" selected>1,000 – 10,000 orders / mo</option>
      <option value="10,000 – 50,000">10,000 – 50,000 orders / mo</option>
      <option value="50,000+">50,000+ orders / mo</option>`;
    document.getElementById('pilot-steps-list').innerHTML = `
      <li><b>Scrape one category:</b> The scraper reads reviews and stores numerical fit values for each size.</li>
      <li><b>Read the shared table:</b> Those fit rows are in the same database from any machine that runs the scraper.</li>
      <li><b>Decide what to look at next:</b> A storefront size advisor is a later step. This starts with the fit table.</li>`;
    document.getElementById('pilot-submit-btn').textContent = 'Request 6-Week Brand Pilot';
  } else {
    selectEl.innerHTML = `
      <option value="Seed / Institutional Investment" selected>Seed / Institutional Investment</option>
      <option value="Angel / Operator Syndicate">Angel / Operator Syndicate</option>
      <option value="Ecommerce Agency / Tech Partner">Ecommerce Agency / Tech Partner</option>`;
    document.getElementById('pilot-steps-list').innerHTML = `
      <li><b>The fit table:</b> What is stored for each SKU and each size.</li>
      <li><b>What stays local:</b> Full review text remains on the machine that scraped it.</li>
      <li><b>How a brand runs it:</b> Clone the repo, scrape, and read the same shared fit rows.</li>`;
    document.getElementById('pilot-submit-btn').textContent = 'Send an investor inquiry';
  }
}

async function handlePilot(e) {
  e.preventDefault();
  const form = e.target;
  const d = new FormData(form);
  const note = document.getElementById('form-note');
  const submit = document.getElementById('pilot-submit-btn');
  if (String(d.get('_honey') || '').trim()) return;

  const subject =
    inquiryMode === 'investor'
      ? 'Pearfit inquiry'
      : 'Pearfit brand pilot inquiry';
  submit.disabled = true;
  note.textContent = 'Sending…';
  try {
    const response = await fetch(
      `https://formsubmit.co/ajax/${encodeURIComponent(INQUIRY_INBOX)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: subject,
          _template: 'table',
          _captcha: 'false',
          _replyto: d.get('email'),
          inquiry_type: inquiryMode === 'investor' ? 'Investor / Partner' : 'Brand Pilot',
          name: d.get('name'),
          email: d.get('email'),
          organization: d.get('store'),
          scale: d.get('volume'),
        }),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false || data.success === 'false') {
      throw new Error(data.message || 'The inquiry was not accepted.');
    }
    note.textContent = data.message || `Sent to ${INQUIRY_INBOX}.`;
    capture('inquiry_submitted', { inquiry_mode: inquiryMode });
    logPostHog('info', 'inquiry delivered', { inquiry_mode: inquiryMode });
    form.reset();
  } catch (err) {
    logPostHog('warn', 'inquiry delivery failed', { inquiry_mode: inquiryMode });
    note.textContent =
      err instanceof Error && err.message
        ? err.message
        : `The inquiry was not sent. Write to ${INQUIRY_INBOX} instead.`;
  } finally {
    submit.disabled = false;
  }
}

// Initialize all interactive controls
document.querySelectorAll('#inquiry-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => setInquiryMode(btn.dataset.mode));
});

document.querySelectorAll('[data-inquiry-switch]').forEach((link) => {
  link.addEventListener('click', () => setInquiryMode(link.dataset.inquirySwitch));
});

initStakeholderTabs();
renderUsual();
renderMatrix();
renderReco();
renderRoi();
document.getElementById('roi-form').addEventListener('input', renderRoi);
document.getElementById('roi-form').addEventListener('change', (e) => {
  capture('roi_calculator_adjusted', { input_name: e.target.name });
});
document.getElementById('pilot-form').addEventListener('submit', handlePilot);
