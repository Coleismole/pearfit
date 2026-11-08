import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSizeChart } from './sizeChart.ts';

test('an inch chest chart is stored as pit-to-pit centimeters', () => {
  const html = `
    <table>
      <caption>Size guide (inches)</caption>
      <tr><th>Size</th><th>Chest</th><th>Length</th><th>Sleeve</th></tr>
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

test('a chart with no unit is ignored', () => {
  const html = `
    <table>
      <tr><th>Size</th><th>Chest</th><th>Length</th></tr>
      <tr><td>S</td><td>36</td><td>28</td></tr>
    </table>`;
  assert.deepEqual(parseSizeChart(html), []);
});
