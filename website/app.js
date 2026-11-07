// Where pilot requests are sent. Replace with the team inbox (or swap the
// submit handler for a real endpoint, e.g. a Supabase table) before launch.
const PILOT_INBOX = 'hello@fitpulse.example';

// Illustrative per-size review split for one sample SKU (percent of reviews).
const SAMPLE_SIZES = [
  { size: 'XS', reviews: 14, small: 7, tts: 43, large: 50 },
  { size: 'S', reviews: 31, small: 6, tts: 52, large: 42 },
  { size: 'M', reviews: 48, small: 10, tts: 71, large: 19 },
  { size: 'L', reviews: 37, small: 5, tts: 41, large: 54 },
  { size: 'XL', reviews: 22, small: 9, tts: 36, large: 55 },
  { size: 'XXL', reviews: 6, small: 17, tts: 66, large: 17 },
];

// Same thresholds as calculateSizeRecommendation in webscraper/src/utils/fitAnalyzer.ts:
// positive skew = runs large, negative = runs small.
const SIZE_UP_AT = -0.3;
const SIZE_DOWN_AT = 0.35;

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
  host.innerHTML = SAMPLE_SIZES.map((r, i) => `
    <div class="mrow${i === activeIdx ? ' active' : ''}">
      <span class="msize">${r.size}</span>
      <div class="mbar" role="img" aria-label="${r.size}: ${r.small}% runs small, ${r.tts}% true to size, ${r.large}% runs large">
        <span class="s" style="width:${r.small}%"></span><span class="t" style="width:${r.tts}%"></span><span class="l" style="width:${r.large}%"></span>
      </div>
      <span class="mverdict">${verdictFor(skewOf(r))}<small>${r.reviews} reviews</small></span>
    </div>`).join('');
}

function renderReco() {
  const { row, skew, recommended, moved, confidence } = recommend(activeIdx);
  const action = moved > 0 ? 'size up' : moved < 0 ? 'size down' : 'stay true to size';
  const sign = skew > 0 ? '+' : '';
  document.getElementById('reco').innerHTML = `
    <h3>Usually ${row.size} → order ${recommended}</h3>
    <p><span class="conf">${confidence}% confidence</span> · advice: ${action}</p>
    <p>In ${row.size}, ${row.large}% of ${row.reviews} reviewers say it runs large and ${row.small}% say small (fit index ${sign}${skew.toFixed(2)}).</p>`;
}

function renderUsual() {
  const host = document.getElementById('usual-size');
  host.innerHTML = SAMPLE_SIZES.map((r, i) =>
    `<button type="button" role="radio" aria-checked="${i === activeIdx}" data-i="${i}">${r.size}</button>`).join('');
  host.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    activeIdx = Number(b.dataset.i);
    renderUsual(); renderMatrix(); renderReco();
    host.querySelector(`[data-i="${activeIdx}"]`).focus();
  }));
}

// ROI estimate
const fmtInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmtUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function renderRoi() {
  const f = document.getElementById('roi-form');
  const n = (name) => Math.max(0, Number(f.elements[name].value) || 0);
  const reduction = n('reduction') / 100;
  const fitReturnsYear = n('orders') * 12 * (Math.min(n('returnRate'), 100) / 100) * (Math.min(n('fitShare'), 100) / 100);
  const avoided = fitReturnsYear * reduction;
  document.getElementById('reduction-out').textContent = `${n('reduction')}%`;
  document.getElementById('roi-returns').textContent = fmtInt.format(avoided);
  document.getElementById('roi-saved').textContent = fmtUsd.format(avoided * n('cost'));
}

// Pilot request: opens the visitor's mail client with their details filled in.
function handlePilot(e) {
  e.preventDefault();
  const d = new FormData(e.target);
  const body = [
    `Name: ${d.get('name')}`,
    `Email: ${d.get('email')}`,
    `Store: ${d.get('store')}`,
    `Monthly orders: ${d.get('volume')}`,
  ].join('\n');
  window.location.href = `mailto:${PILOT_INBOX}?subject=${encodeURIComponent('FitPulse pilot request')}&body=${encodeURIComponent(body)}`;
  document.getElementById('form-note').textContent = 'Thanks! Send the email that just opened and we’ll be in touch.';
}

renderUsual();
renderMatrix();
renderReco();
renderRoi();
document.getElementById('roi-form').addEventListener('input', renderRoi);
document.getElementById('pilot-form').addEventListener('submit', handlePilot);
