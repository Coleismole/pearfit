import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSizeChart, parseSizeChartFirst } from './sizeChart.ts';

test('an inch chest chart is stored as pit-to-pit centimeters', () => {
  const html = `
    <table>
      <caption>Size guide (inches)</caption>
      <tr><th>Size</th><th>Chest circumference</th><th>Length</th><th>Sleeve</th></tr>
      <tr><td>S</td><td>36</td><td>28</td><td>33</td></tr>
      <tr><td>M</td><td>40</td><td>29</td><td>34</td></tr>
    </table>`;
  // 36 in circumference → 36 × 2.54 / 2 = 45.72 → 45.7
  // 28 in → 71.12 → 71.1; 33 in → 83.82 → 83.8
  // 40 in → 50.8; 29 in → 73.66 → 73.7; 34 in → 86.36 → 86.4
  assert.deepEqual(parseSizeChart(html), [
    { size: 'S', sortOrder: 1, chest_cm: 45.7, length_cm: 71.1, sleeve_cm: 83.8 },
    { size: 'M', sortOrder: 2, chest_cm: 50.8, length_cm: 73.7, sleeve_cm: 86.4 },
  ]);
});

test('pit-to-pit centimeters are kept and a missing sleeve stays null', () => {
  const html = `
    <h2>Size guide</h2>
    <table>
      <tr><th>Size</th><th>Pit to pit (cm)</th><th>Body length (cm)</th><th>Sleeve (cm)</th></tr>
      <tr><td>M</td><td>54</td><td>72</td><td></td></tr>
    </table>`;
  assert.deepEqual(parseSizeChart(html), [
    { size: 'M', sortOrder: 2, chest_cm: 54, length_cm: 72, sleeve_cm: null },
  ]);
});

test('a labeled circumference is halved and body width in inches is not', () => {
  const circ = `
    <table>
      <tr><th>Size</th><th>Chest circumference</th></tr>
      <tr><td>L</td><td>110 cm</td></tr>
    </table>`;
  assert.equal(parseSizeChart(circ)[0].chest_cm, 55);

  const flat = `
    <table>
      <tr><th>Size</th><th>Body width (in)</th></tr>
      <tr><td>M</td><td>21</td></tr>
    </table>`;
  // 21 × 2.54 = 53.34 → 53.3
  assert.equal(parseSizeChart(flat)[0].chest_cm, 53.3);
});

test('a transposed chart keeps a missing cell and a range as null', () => {
  const html = `
    <table>
      <caption>Size chart (cm)</caption>
      <tr><th>Size</th><th>S</th><th>M</th></tr>
      <tr><th>Pit to pit</th><td>50</td><td>54-56</td></tr>
      <tr><th>Body length</th><td></td><td>72</td></tr>
      <tr><th>Sleeve</th><td>—</td><td>64</td></tr>
    </table>`;
  assert.deepEqual(parseSizeChart(html), [
    { size: 'S', sortOrder: 1, chest_cm: 50, length_cm: null, sleeve_cm: null },
    { size: 'M', sortOrder: 2, chest_cm: null, length_cm: 72, sleeve_cm: 64 },
  ]);
});

test('a div size guide is read when the page has no table', () => {
  const html = `
    <div class="size-chart">
      <div class="row"><span>Size</span><span>Pit to pit (cm)</span><span>Sleeve (cm)</span></div>
      <div class="row"><span>L</span><span>58</span><span>n/a</span></div>
    </div>`;
  assert.deepEqual(parseSizeChart(html), [
    { size: 'L', sortOrder: 3, chest_cm: 58, length_cm: null, sleeve_cm: null },
  ]);
});

test('a chart with no unit is ignored', () => {
  const html = `
    <table>
      <tr><th>Size</th><th>Chest</th><th>Length</th></tr>
      <tr><td>S</td><td>36</td><td>28</td></tr>
    </table>`;
  assert.deepEqual(parseSizeChart(html), []);
});

test('a chest header that does not say flat or circumference gives null, not a guess', () => {
  const html = `
    <table>
      <caption>Size guide (cm)</caption>
      <tr><th>Size</th><th>Chest</th><th>Length</th></tr>
      <tr><td>M</td><td>54</td><td>72</td></tr>
      <tr><td>L</td><td>110</td><td>74</td></tr>
    </table>`;
  // 54 and 110 would both have been guessed before. Length is unaffected.
  assert.deepEqual(parseSizeChart(html), [
    { size: 'M', sortOrder: 2, chest_cm: null, length_cm: 72, sleeve_cm: null },
    { size: 'L', sortOrder: 3, chest_cm: null, length_cm: 74, sleeve_cm: null },
  ]);
});

test('an unspecified chest row in a transposed chart is null too', () => {
  const html = `
    <table>
      <caption>Size chart (cm)</caption>
      <tr><th>Size</th><th>S</th><th>M</th></tr>
      <tr><th>Chest</th><td>50</td><td>54</td></tr>
      <tr><th>Body length</th><td>70</td><td>72</td></tr>
    </table>`;
  assert.deepEqual(parseSizeChart(html), [
    { size: 'S', sortOrder: 1, chest_cm: null, length_cm: 70, sleeve_cm: null },
    { size: 'M', sortOrder: 2, chest_cm: null, length_cm: 72, sleeve_cm: null },
  ]);
});

test('a half inch and a one-digit size are kept', () => {
  const html = `
    <table>
      <caption>Size guide (inches)</caption>
      <tr><th>Size</th><th>Body width</th><th>Length</th></tr>
      <tr><td>2</td><td>16 1/2</td><td>27</td></tr>
      <tr><td>8 (US)</td><td>19</td><td>28½</td></tr>
    </table>`;
  // 16.5 × 2.54 = 41.91 → 41.9; 27 × 2.54 = 68.58 → 68.6
  // 19 × 2.54 = 48.26 → 48.3; 28.5 × 2.54 = 72.39 → 72.4
  assert.deepEqual(parseSizeChart(html), [
    { size: '2', sortOrder: 1002, chest_cm: 41.9, length_cm: 68.6, sleeve_cm: null },
    { size: '8', sortOrder: 1008, chest_cm: 48.3, length_cm: 72.4, sleeve_cm: null },
  ]);
});

test('a chart whose only numbers are an unspecified chest yields no rows', () => {
  const html = `
    <table>
      <caption>Size guide (cm)</caption>
      <tr><th>Size</th><th>Chest</th></tr>
      <tr><td>M</td><td>54</td></tr>
    </table>`;
  assert.deepEqual(parseSizeChart(html), []);
});

const CM_CHART = `
  <table>
    <caption>Size guide (cm)</caption>
    <tr><th>Size</th><th>Body width</th><th>Body length</th></tr>
    <tr><td>M</td><td>52</td><td>70</td></tr>
  </table>`;
const CM_CHART_ROWS = [{ size: 'M', sortOrder: 2, chest_cm: 52, length_cm: 70, sleeve_cm: null }];

test('parseSizeChartFirst uses the first page that has a chart', () => {
  const other = CM_CHART.replace('52', '99');
  assert.deepEqual(parseSizeChartFirst(CM_CHART, other), CM_CHART_ROWS);
});

test('parseSizeChartFirst falls back when the first page has no chart, and skips missing pages', () => {
  const reviewsOnly = '<html><body><article class="review-card">Runs small</article></body></html>';
  assert.deepEqual(parseSizeChartFirst(reviewsOnly, null, undefined, '', CM_CHART), CM_CHART_ROWS);
});

test('parseSizeChartFirst returns no rows when no page has a chart', () => {
  assert.deepEqual(parseSizeChartFirst('<p>nothing</p>', null), []);
  assert.deepEqual(parseSizeChartFirst(), []);
});

const UNIQLO_STYLE_TABLE = `
  <table class="size-chart"><tbody>
    <tr><th>Size</th><th>Body length back</th><th>Shoulder width<br>(seam to seam)</th><th>Body width</th><th>Sleeve length<br>(center back)</th></tr>
    <tr><td>XS</td><td>25 ½</td><td>17 ¼</td><td>19 ¼</td><td>16 ½</td></tr>
    <tr><td>S</td><td>26 ¾</td><td>17 ¾</td><td>20 ½</td><td>17 ¼</td></tr>
  </tbody></table>`;

const unitToggle = (cmChecked: boolean, inChecked: boolean) => `
  <div class="drawer">
    <input type="radio" name="drawer-measurement-unit" id="drawer-unit-cm" aria-checked="${cmChecked}" ${cmChecked ? 'checked' : ''}>
    <label for="drawer-unit-cm">CM</label>
    <input type="radio" name="drawer-measurement-unit" id="drawer-unit-inch" aria-checked="${inChecked}" ${inChecked ? 'checked' : ''}>
    <label for="drawer-unit-inch">IN</label>
    ${UNIQLO_STYLE_TABLE}
  </div>`;

test('a chart with no unit text uses the checked unit radio of its own toggle', () => {
  // Inches, as the checked radio says. Shoulder width is not a measurement we store.
  // XS: 25.5 × 2.54 = 64.77 → 64.8; 19.25 × 2.54 = 48.895 → 48.9; 16.5 × 2.54 = 41.91 → 41.9
  // S:  26.75 × 2.54 = 67.945 → 67.9; 20.5 × 2.54 = 52.07 → 52.1; 17.25 × 2.54 = 43.815 → 43.8
  assert.deepEqual(parseSizeChart(unitToggle(false, true)), [
    { size: 'XS', sortOrder: 0, chest_cm: 48.9, length_cm: 64.8, sleeve_cm: 41.9 },
    { size: 'S', sortOrder: 1, chest_cm: 52.1, length_cm: 67.9, sleeve_cm: 43.8 },
  ]);
});

test('a unit toggle with nothing checked, or with two units checked, gives no unit and no rows', () => {
  assert.deepEqual(parseSizeChart(unitToggle(false, false)), []);
  assert.deepEqual(parseSizeChart(unitToggle(true, true)), []);
});

test('radios that are not a unit control are ignored', () => {
  const html = `
    <div>
      <input type="radio" name="color" id="color-in-stock" checked>
      ${UNIQLO_STYLE_TABLE}
    </div>`;
  assert.deepEqual(parseSizeChart(html), []);
});

test('a unit stated in the chart wins over the toggle', () => {
  const html = `
    <div>
      <input type="radio" name="measurement-unit" id="unit-inch" aria-checked="true" checked>
      <table>
        <caption>Size guide (cm)</caption>
        <tr><th>Size</th><th>Body width</th></tr>
        <tr><td>M</td><td>54</td></tr>
      </table>
    </div>`;
  assert.deepEqual(parseSizeChart(html), [
    { size: 'M', sortOrder: 2, chest_cm: 54, length_cm: null, sleeve_cm: null },
  ]);
});

test('a range that starts with a fraction is not read as its first number', () => {
  const html = `
    <table>
      <caption>Size guide (inches)</caption>
      <tr><th>Size</th><th>Body width</th><th>Length</th></tr>
      <tr><td>M</td><td>25 ½ - 26</td><td>28</td></tr>
    </table>`;
  // 28 × 2.54 = 71.12 → 71.1
  assert.deepEqual(parseSizeChart(html), [
    { size: 'M', sortOrder: 2, chest_cm: null, length_cm: 71.1, sleeve_cm: null },
  ]);
});
