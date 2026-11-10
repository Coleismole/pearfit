import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGuidePageChart, parseSizeChart, parseSizeChartFirst, parseSizeChartWithGuides } from './sizeChart.ts';

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

test('a cell with two numbers around a slash is null, not a division', () => {
  const html = `
    <table>
      <caption>Size chart (cm)</caption>
      <tr><th>Size</th><th>Body width</th><th>Body length</th><th>Sleeve length</th></tr>
      <tr><td>M</td><td>56 / 22</td><td>71/28</td><td>21 1/2 in</td></tr>
      <tr><td>L</td><td>59</td><td>74</td><td>3/4</td></tr>
    </table>`;
  // 56 / 22 and 71/28 are two values side by side: null. 21 1/2 in = 21.5 × 2.54 = 54.61 → 54.6.
  // A lone 3/4 cm is a real tape fraction: 0.75 → 0.8.
  assert.deepEqual(parseSizeChart(html), [
    { size: 'M', sortOrder: 2, chest_cm: null, length_cm: null, sleeve_cm: 54.6 },
    { size: 'L', sortOrder: 3, chest_cm: 59, length_cm: 74, sleeve_cm: 0.8 },
  ]);
});

test('a decimal comma is read as a decimal point', () => {
  const html = `
    <table>
      <caption>cm</caption>
      <tr><th>Size</th><th>Body width</th><th>Length</th></tr>
      <tr><td>M</td><td>55,5</td><td>71,25</td></tr>
    </table>`;
  // 55,5 → 55.5; 71,25 → 71.25 → 71.3
  assert.deepEqual(parseSizeChart(html), [
    { size: 'M', sortOrder: 2, chest_cm: 55.5, length_cm: 71.3, sleeve_cm: null },
  ]);
});

test('a transposed chart that repeats a size keeps the first column only', () => {
  const html = `
    <table>
      <caption>cm</caption>
      <tr><th>Size</th><th>XL</th><th>1XL</th><th>XXL</th></tr>
      <tr><td>Body width</td><td>60</td><td>61</td><td>64</td></tr>
    </table>`;
  // XL and 1XL both mean XL. The first column (60) wins; 1XL (61) is dropped.
  assert.deepEqual(parseSizeChart(html), [
    { size: 'XL', sortOrder: 4, chest_cm: 60, length_cm: null, sleeve_cm: null },
    { size: 'XXL', sortOrder: 5, chest_cm: 64, length_cm: null, sleeve_cm: null },
  ]);
});

test('a cell that shows cm and inches in separate elements is read in cm', () => {
  // Kotn renders both units for its cm/inch toggle: <span>61.5cm</span><span>24"</span>.
  const html = `
    <table>
      <tr><th>Size</th><th>Front Length</th><th>Chest Width</th></tr>
      <tr><td>XS</td><td><span>61.5cm</span><span>24&quot;</span></td><td><span>50cm</span><span>20&quot;</span></td></tr>
      <tr><td>M</td><td><span>64cm</span><span>25&quot;</span></td><td><span>56cm</span><span>22&quot;</span></td></tr>
    </table>`;
  // Chest width is flat (pit to pit): 50 and 56 cm as stated. Length 61.5 and 64 cm.
  assert.deepEqual(parseSizeChart(html), [
    { size: 'XS', sortOrder: 0, chest_cm: 50, length_cm: 61.5, sleeve_cm: null },
    { size: 'M', sortOrder: 2, chest_cm: 56, length_cm: 64, sleeve_cm: null },
  ]);
});

test('the unit comes from the table id or a unit sentence, never from the labels of a toggle', () => {
  const tabs = `<a href="#t-in" class="active">in</a> <a href="#t-cm">cm</a>`;
  const rows = `<tr><td>Size</td><td>Pit to pit</td><td>Body Length</td></tr><tr><td>XS</td><td>22 1/4</td><td>24 1/2</td></tr>`;
  // The table says inches in its id: 22.25 x 2.54 = 56.515 -> 56.5; 24.5 x 2.54 = 62.23 -> 62.2
  assert.deepEqual(parseSizeChart(`<div>${tabs}<table id="size-chart-table--in">${rows}</table></div>`), [
    { size: 'XS', sortOrder: 0, chest_cm: 56.5, length_cm: 62.2, sleeve_cm: null },
  ]);
  // Only the toggle labels "in" and "cm" around a table that names no unit: unknown, so no rows.
  assert.deepEqual(parseSizeChart(`<div>${tabs}<table>${rows}</table></div>`), []);
  // A sentence that states the unit.
  assert.deepEqual(parseSizeChart(`<div><p>All units are in inches.</p><table>${rows}</table></div>`), [
    { size: 'XS', sortOrder: 0, chest_cm: 56.5, length_cm: 62.2, sleeve_cm: null },
  ]);
  // "in cm and inches" states no single unit.
  assert.deepEqual(parseSizeChart(`<div><p>Measurements are in cm and inches.</p><table>${rows}</table></div>`), []);
});

test('a half chest row is a flat chest, in a transposed chart', () => {
  const html = `
    <table class="size-chart-cm">
      <caption>Size chart (cm)</caption>
      <tr><td></td><td>S</td><td>M</td></tr>
      <tr><td>1/2 Chest</td><td>58</td><td>60</td></tr>
      <tr><td>Sleeve</td><td>77</td><td>79</td></tr>
    </table>`;
  assert.deepEqual(parseSizeChart(html), [
    { size: 'S', sortOrder: 1, chest_cm: 58, length_cm: null, sleeve_cm: 77 },
    { size: 'M', sortOrder: 2, chest_cm: 60, length_cm: null, sleeve_cm: 79 },
  ]);
});

test('armpit to armpit, underarm to underarm and P2P headers are pit to pit, flat', () => {
  for (const header of ['Armpit to Armpit', 'Underarm-to-Underarm', 'P2P', 'Chest (Armpit-Armpit)']) {
    const html = `
      <table>
        <caption>Garment measurements (inches)</caption>
        <tr><th>Size</th><th>${header}</th><th>Body Length</th></tr>
        <tr><td>M</td><td>21</td><td>29</td></tr>
      </table>`;
    // 21 x 2.54 = 53.34 -> 53.3; 29 x 2.54 = 73.66 -> 73.7
    assert.deepEqual(parseSizeChart(html), [
      { size: 'M', sortOrder: 2, chest_cm: 53.3, length_cm: 73.7, sleeve_cm: null },
    ], header);
  }
});

test('a cell with its own data-cm value is read in centimeters whatever the toggle shows', () => {
  const html = `
    <div class="size-chart-wrapper">
      <div class="unit-toggle">
        <button class="unit-btn" data-unit="cm">CM</button>
        <button class="unit-btn active" data-unit="in">IN</button>
      </div>
      <table>
        <tr><th></th><th>Length from High Shoulder Point (A)</th><th>Sleeve Length from Shoulder (E)</th></tr>
        <tr><td>M</td><td data-cm="71.0">28</td><td data-cm="26.0">10.2</td></tr>
      </table>
    </div>`;
  // 71.0 and 26.0 come from data-cm; the visible inch text is ignored.
  assert.deepEqual(parseSizeChart(html), [
    { size: 'M', sortOrder: 2, chest_cm: null, length_cm: 71, sleeve_cm: 26 },
  ]);
});

test('a cm/inch toggle made of buttons gives the unit of the active one', () => {
  const html = `
    <div class="chart">
      <button data-unit="cm" class="active">cm</button>
      <button data-unit="in">in</button>
      <table>
        <tr><th>Size</th><th>Pit to pit</th><th>Length</th></tr>
        <tr><td>L</td><td>58</td><td>74</td></tr>
      </table>
    </div>`;
  assert.deepEqual(parseSizeChart(html), [
    { size: 'L', sortOrder: 3, chest_cm: 58, length_cm: 74, sleeve_cm: null },
  ]);
  // Inches active: 22 x 2.54 = 55.88 -> 55.9; 29 x 2.54 = 73.66 -> 73.7
  const inches = html
    .replace('data-unit="cm" class="active"', 'data-unit="cm"')
    .replace('data-unit="in"', 'data-unit="in" class="active"')
    .replace('58', '22')
    .replace('74', '29');
  assert.deepEqual(parseSizeChart(inches), [
    { size: 'L', sortOrder: 3, chest_cm: 55.9, length_cm: 73.7, sleeve_cm: null },
  ]);
});

const GUIDE_PAGE = `
  <h1>Size guide</h1>
  <h2>Men's tops</h2>
  <table>
    <caption>Measured flat (cm)</caption>
    <tr><th>Size</th><th>Pit to pit</th><th>Length</th></tr>
    <tr><td>M</td><td>54</td><td>72</td></tr>
    <tr><td>L</td><td>57</td><td>74</td></tr>
  </table>
  <h2>Women's tops</h2>
  <table>
    <caption>Measured flat (cm)</caption>
    <tr><th>Size</th><th>Pit to pit</th><th>Length</th></tr>
    <tr><td>M</td><td>47</td><td>62</td></tr>
    <tr><td>L</td><td>50</td><td>64</td></tr>
  </table>
  <h2>Men's bottoms</h2>
  <table>
    <caption>Measured flat (cm)</caption>
    <tr><th>Size</th><th>Waist</th><th>Length</th></tr>
    <tr><td>M</td><td>40</td><td>100</td></tr>
  </table>`;

test('a size guide page gives the table that fits the product, and none when it cannot tell', () => {
  // A men's shirt: the men's tops table (54/72, 57/74). The women's one and the bottoms table are ruled out.
  assert.deepEqual(parseGuidePageChart(GUIDE_PAGE, { name: 'Linen Shirt', url: 'https://shop.test/products/mens-linen-shirt' }), [
    { size: 'M', sortOrder: 2, chest_cm: 54, length_cm: 72, sleeve_cm: null },
    { size: 'L', sortOrder: 3, chest_cm: 57, length_cm: 74, sleeve_cm: null },
  ]);
  // Women's tee: 47/62 and 50/64.
  assert.deepEqual(parseGuidePageChart(GUIDE_PAGE, { name: "Women's Tee" })[1], {
    size: 'L',
    sortOrder: 3,
    chest_cm: 50,
    length_cm: 64,
    sleeve_cm: null,
  });
  // A tee with no gender in its name: both tops tables fit and they differ, so no chart. Bottoms have no chest column.
  assert.deepEqual(parseGuidePageChart(GUIDE_PAGE, { name: 'Crew Tee' }), []);
  // Chinos: the only table with a chest column is a top, which is ruled out.
  assert.deepEqual(parseGuidePageChart(GUIDE_PAGE, { name: "Men's Chino Pants" }), []);
});

test('the product page chart wins; a linked guide page is the fallback', () => {
  const own = `<table><caption>cm</caption><tr><th>Size</th><th>Pit to pit</th></tr><tr><td>S</td><td>50</td></tr></table>`;
  const hint = { name: "Men's Shirt" };
  assert.equal(parseSizeChartWithGuides([own], [GUIDE_PAGE], hint)[0].chest_cm, 50);
  assert.equal(parseSizeChartWithGuides(['<p>no chart</p>'], [null, GUIDE_PAGE], hint)[0].chest_cm, 54);
  assert.deepEqual(parseSizeChartWithGuides([], [], hint), []);
});

test('an unlabeled chest is a flat width when the chart says the garment is measured lying flat', () => {
  const html = `
    <div>
      <table>
        <tr><th>Size</th><th>Chest</th><th>Length</th></tr>
        <tr><td>M</td><td>55 cm</td><td>71 cm</td></tr>
      </table>
      <p>We measure lying flat, so you may need to double some measurements.</p>
    </div>`;
  assert.deepEqual(parseSizeChart(html), [
    { size: 'M', sortOrder: 2, chest_cm: 55, length_cm: 71, sleeve_cm: null },
  ]);
  // Care text ("lay flat to dry") or a body-measurement hint does not confirm it.
  const care = html.replace('We measure lying flat, so you may need to double some measurements.', 'Lay flat to dry.');
  assert.equal(parseSizeChart(care)[0].chest_cm, null);
  const body = html.replace('so you may need to double some measurements.', 'and body measurements are on the next tab.');
  assert.equal(parseSizeChart(body)[0].chest_cm, null);
});
