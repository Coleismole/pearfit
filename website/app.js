// Where pilot and investor requests are sent.
const INQUIRY_INBOX = 'customerservice@pearfit.app';

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

// ROI Calculator with Exact Integer Reconciliation & Bracketing Tax
function renderRoi() {
  const f = document.getElementById('roi-form');
  if (!f) return;
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

renderRoi();
const roiForm = document.getElementById('roi-form');
if (roiForm) {
  roiForm.addEventListener('input', renderRoi);
  roiForm.addEventListener('change', (e) => {
    capture('roi_calculator_adjusted', { input_name: e.target.name });
  });
}
document.getElementById('pilot-form')?.addEventListener('submit', handlePilot);
