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

const REFERENCE_GARMENTS = [
  {
    id: 'uniqlo-oxford-m',
    brand: 'Uniqlo',
    item: 'Oxford Regular Fit Shirt',
    size: 'M',
    measurements: { chestCm: 56.5, shoulderCm: 46.0, lengthCm: 74.5 },
  },
  {
    id: 'jcrew-broken-in-m',
    brand: 'J.Crew',
    item: 'Broken-in Organic Cotton Tee',
    size: 'M',
    measurements: { chestCm: 53.5, shoulderCm: 45.0, lengthCm: 71.0 },
  },
  {
    id: 'cos-relaxed-l',
    brand: 'COS',
    item: 'Relaxed Heavyweight Overshirt',
    size: 'L',
    measurements: { chestCm: 60.5, shoulderCm: 49.0, lengthCm: 75.5 },
  },
  {
    id: 'patagonia-fiord-s',
    brand: 'Patagonia',
    item: 'Fjord Flannel Shirt',
    size: 'S',
    measurements: { chestCm: 52.0, shoulderCm: 43.5, lengthCm: 70.5 },
  },
];

const TARGET_OXFORD_SHIRT = {
  id: 'washed-oxford-shirt',
  brand: 'Studio Mercer',
  title: 'Washed Everyday Oxford Shirt',
  price: 88,
  category: 'Woven Shirts · 195 gsm organic cotton',
  sizes: {
    S: { chestCm: 53.0, shoulderCm: 44.0, lengthCm: 71.5 },
    M: { chestCm: 58.0, shoulderCm: 46.5, lengthCm: 73.5 },
    L: { chestCm: 61.5, shoulderCm: 48.5, lengthCm: 75.5 },
    XL: { chestCm: 65.0, shoulderCm: 50.5, lengthCm: 77.5 },
  },
};

const SIZE_UP_AT = -0.3;
const SIZE_DOWN_AT = 0.35;

const fmtInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmtUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function formatDelta(val) {
  if (val > 0) return `+${val.toFixed(1)} cm`;
  if (val < 0) return `−${Math.abs(val).toFixed(1)} cm`;
  return '0.0 cm';
}

function buildShirtSvgPath(m) {
  const cx = 100;
  const topY = 22;
  const halfShoulder = Number((50 + (m.shoulderCm - 46) * 2.2).toFixed(1));
  const halfChest = Number((42 + (m.chestCm - 56.5) * 1.9).toFixed(1));
  const bodyBottomY = Number((topY + 140 + (m.lengthCm - 74.5) * 3.0).toFixed(1));

  const sleeveTipX = Number((halfShoulder + 22).toFixed(1));
  const sleeveTopY = Number((topY + 18).toFixed(1));
  const sleeveBottomY = Number((topY + 52).toFixed(1));
  const armpitY = Number((topY + 46).toFixed(1));

  return [
    `M ${cx - 18} ${topY}`,
    `Q ${cx} ${topY + 10} ${cx + 18} ${topY}`,
    `L ${cx + halfShoulder} ${topY + 8}`,
    `L ${cx + sleeveTipX} ${sleeveTopY}`,
    `L ${cx + sleeveTipX - 9} ${sleeveBottomY}`,
    `L ${cx + halfChest} ${armpitY}`,
    `L ${cx + halfChest} ${bodyBottomY}`,
    `L ${cx - halfChest} ${bodyBottomY}`,
    `L ${cx - halfChest} ${armpitY}`,
    `L ${cx - sleeveTipX + 9} ${sleeveBottomY}`,
    `L ${cx - sleeveTipX} ${sleeveTopY}`,
    `L ${cx - halfShoulder} ${topY + 8}`,
    'Z',
  ].join(' ');
}

function matchGarmentToProduct(reference, product = TARGET_OXFORD_SHIRT) {
  const sizeKeys = Object.keys(product.sizes);
  let bestSize = sizeKeys[0];
  let bestScore = Infinity;

  for (const sz of sizeKeys) {
    const m = product.sizes[sz];
    const chestDiff = Math.abs(m.chestCm - reference.measurements.chestCm) * 1.6;
    const shoulderDiff = Math.abs(m.shoulderCm - reference.measurements.shoulderCm) * 1.4;
    const lengthDiff = Math.abs(m.lengthCm - reference.measurements.lengthCm) * 0.7;
    const score = chestDiff + shoulderDiff + lengthDiff;
    if (score < bestScore) {
      bestScore = score;
      bestSize = sz;
    }
  }
  return { recommendedSize: bestSize };
}

function computeGarmentOverlay(reference, selectedSize, product = TARGET_OXFORD_SHIRT) {
  const targetMeasurements = product.sizes[selectedSize] || product.sizes.M;
  const referenceMeasurements = reference.measurements;

  const chestDeltaCm = Number((targetMeasurements.chestCm - referenceMeasurements.chestCm).toFixed(1));
  const shoulderDeltaCm = Number((targetMeasurements.shoulderCm - referenceMeasurements.shoulderCm).toFixed(1));
  const lengthDeltaCm = Number((targetMeasurements.lengthCm - referenceMeasurements.lengthCm).toFixed(1));

  const distanceScore =
    Math.abs(chestDeltaCm) * 1.6 + Math.abs(shoulderDeltaCm) * 1.4 + Math.abs(lengthDeltaCm) * 0.7;
  const inspectedConfidence = Math.max(42, Math.min(97, Math.round(96 - distanceScore * 1.8)));
  const inspectedReviewRow = SAMPLE_SIZES.find((r) => r.size === selectedSize) || SAMPLE_SIZES[2];

  let fitNote = 'Balanced ease across chest and shoulder';
  if (chestDeltaCm < -2.0 || shoulderDeltaCm < -1.5) {
    fitNote = 'Tighter through chest & shoulders than your reference';
  } else if (chestDeltaCm > 3.5 || shoulderDeltaCm > 2.0) {
    fitNote = 'Noticeably wider & longer oversize drape';
  } else if (Math.abs(chestDeltaCm) <= 1.8 && Math.abs(shoulderDeltaCm) <= 1.2) {
    fitNote = 'Closest silhouette match to your closet piece';
  }

  return {
    targetSize: selectedSize,
    targetMeasurements,
    referenceMeasurements,
    chestDeltaCm,
    shoulderDeltaCm,
    lengthDeltaCm,
    targetPath: buildShirtSvgPath(targetMeasurements),
    referencePath: buildShirtSvgPath(referenceMeasurements),
    fitNote,
    inspectedConfidence,
    inspectedReviewRow,
  };
}

// Hero PDP state
let selectedRefId = REFERENCE_GARMENTS[0].id;
let manualPdpSize = null;

function renderHeroPdp() {
  const selectedRef = REFERENCE_GARMENTS.find((g) => g.id === selectedRefId) || REFERENCE_GARMENTS[0];
  const match = matchGarmentToProduct(selectedRef);
  const displayedSize = manualPdpSize || match.recommendedSize;
  const geo = computeGarmentOverlay(selectedRef, displayedSize);

  document.getElementById('overlay-target-path').setAttribute('d', geo.targetPath);
  document.getElementById('overlay-ref-path').setAttribute('d', geo.referencePath);
  document.getElementById('overlay-target-label').textContent =
    `Target Size ${displayedSize} (${geo.targetMeasurements.chestCm} cm chest)`;
  document.getElementById('overlay-ref-label').textContent =
    `Your ${selectedRef.brand} (${selectedRef.size} · ${geo.referenceMeasurements.chestCm} cm)`;

  const sizesHost = document.getElementById('pdp-sizes');
  sizesHost.innerHTML = Object.keys(TARGET_OXFORD_SHIRT.sizes)
    .map(
      (sz) =>
        `<button type="button" class="${displayedSize === sz ? 'on' : ''}" data-sz="${sz}">${sz}</button>`
    )
    .join('');

  sizesHost.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      manualPdpSize = btn.dataset.sz;
      renderHeroPdp();
    });
  });

  const headline =
    displayedSize === match.recommendedSize
      ? `Sample: size ${match.recommendedSize}`
      : `Sample: inspecting size ${displayedSize} (closest: ${match.recommendedSize})`;

  document.getElementById('pdp-advisor').innerHTML = `
    <div class="advisor-head">
      <strong>${headline}</strong>
      <span class="advisor-conf">${geo.inspectedConfidence}% sample score</span>
    </div>
    <p>Overlaying Size <b>${displayedSize}</b> onto your <b>${selectedRef.brand} ${selectedRef.item}</b> (${selectedRef.size}). ${geo.fitNote}.</p>
    <dl class="ease">
      <div><dt>Chest</dt><dd>${formatDelta(geo.chestDeltaCm)}</dd></div>
      <div><dt>Shoulder</dt><dd>${formatDelta(geo.shoulderDeltaCm)}</dd></div>
      <div><dt>Length</dt><dd>${formatDelta(geo.lengthDeltaCm)}</dd></div>
    </dl>
    <p class="advisor-foot">Review signal in Size ${displayedSize}: ${geo.inspectedReviewRow.tts}% report true to size (${geo.inspectedReviewRow.reviews} reviews)</p>
  `;
}

// Audience Bento Filter
function initStakeholderTabs() {
  const tabsHost = document.getElementById('stakeholder-tabs');
  const cards = document.querySelectorAll('#bento-grid .bento-card');
  tabsHost.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      tabsHost.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-selected', String(b === btn));
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
    <div class="mrow${i === activeIdx ? ' active' : ''}" role="button" tabindex="0" data-i="${i}">
      <span class="msize">${r.size}</span>
      <div class="mbar" role="img" aria-label="${r.size}: ${r.small}% runs small, ${r.tts}% true to size, ${r.large}% runs large">
        <span class="s" style="width:${r.small}%"></span><span class="t" style="width:${r.tts}%"></span><span class="l" style="width:${r.large}%"></span>
      </div>
      <span class="mverdict">${verdictFor(skewOf(r))}<small>${r.reviews} reviews</small></span>
    </div>`
  ).join('');

  host.querySelectorAll('.mrow').forEach((rowEl) => {
    rowEl.addEventListener('click', () => {
      activeIdx = Number(rowEl.dataset.i);
      renderUsual();
      renderMatrix();
      renderReco();
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
    (r, i) => `<button type="button" role="radio" aria-checked="${i === activeIdx}" data-i="${i}">${r.size}</button>`
  ).join('');
  host.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      activeIdx = Number(b.dataset.i);
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
  document.querySelectorAll('#inquiry-tabs button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.mode === mode));
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
    form.reset();
  } catch (err) {
    note.textContent =
      err instanceof Error && err.message
        ? err.message
        : `The inquiry was not sent. Write to ${INQUIRY_INBOX} instead.`;
  } finally {
    submit.disabled = false;
  }
}

// Initialize all interactive controls
document.getElementById('closet-select').addEventListener('change', (e) => {
  selectedRefId = e.target.value;
  manualPdpSize = null;
  renderHeroPdp();
});

document.querySelectorAll('#inquiry-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => setInquiryMode(btn.dataset.mode));
});

document.querySelectorAll('[data-inquiry-switch]').forEach((link) => {
  link.addEventListener('click', () => setInquiryMode(link.dataset.inquirySwitch));
});

renderHeroPdp();
initStakeholderTabs();
renderUsual();
renderMatrix();
renderReco();
renderRoi();
document.getElementById('roi-form').addEventListener('input', renderRoi);
document.getElementById('pilot-form').addEventListener('submit', handlePilot);
