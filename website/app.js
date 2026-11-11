// Where brand pilot requests are sent.
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
async function handlePilot(e) {
  e.preventDefault();
  const form = e.target;
  const d = new FormData(form);
  const note = document.getElementById('form-note');
  const submit = document.getElementById('pilot-submit-btn');
  if (String(d.get('_honey') || '').trim()) return;

  submit.disabled = true;
  note.textContent = 'Sending…';
  try {
    const response = await fetch(
      `https://formsubmit.co/ajax/${encodeURIComponent(INQUIRY_INBOX)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: 'Pearfit brand pilot inquiry',
          _template: 'table',
          _captcha: 'false',
          _replyto: d.get('email'),
          inquiry_type: 'Brand Pilot',
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
    capture('inquiry_submitted', { inquiry_mode: 'pilot' });
    logPostHog('info', 'inquiry delivered', { inquiry_mode: 'pilot' });
    form.reset();
  } catch (err) {
    logPostHog('warn', 'inquiry delivery failed', { inquiry_mode: 'pilot' });
    note.textContent =
      err instanceof Error && err.message
        ? err.message
        : `The inquiry was not sent. Write to ${INQUIRY_INBOX} instead.`;
  } finally {
    submit.disabled = false;
  }
}

// Initialize all interactive controls
renderRoi();
const roiForm = document.getElementById('roi-form');
if (roiForm) {
  roiForm.addEventListener('input', renderRoi);
  roiForm.addEventListener('change', (e) => {
    capture('roi_calculator_adjusted', { input_name: e.target.name });
  });
}
document.getElementById('pilot-form')?.addEventListener('submit', handlePilot);
