import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSizeChart } from './sizeChart.ts';

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
