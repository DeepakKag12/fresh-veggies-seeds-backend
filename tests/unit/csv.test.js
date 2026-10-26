const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, escapeCsvCell } = require('../../src/utils/csv.util');

test('CSV Utility - parseCsv', async (t) => {
  await t.test('parses simple CSV correctly', () => {
    const csv = 'name,price,stock\nTomato Seeds,49,100\nBasil Seeds,39,50';
    const result = parseCsv(csv);
    assert.strictEqual(result.headers.length, 3);
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rows[0].name, 'Tomato Seeds');
    assert.strictEqual(result.rows[0].price, '49');
    assert.strictEqual(result.rows[0].stock, '100');
    assert.strictEqual(result.rows[0].__rowNumber, 2);
  });

  await t.test('handles RFC-4180 quotes, commas inside cells, and escaped quotes', () => {
    const csv = 'name,description,price\n"Heirloom Tomato","Juicy, red & delicious",99\n"Super ""Sweet"" Corn","Crispy, sweet",75';
    const result = parseCsv(csv);
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rows[0].description, 'Juicy, red & delicious');
    assert.strictEqual(result.rows[1].name, 'Super "Sweet" Corn');
  });

  await t.test('handles CRLF line endings', () => {
    const csv = 'name,price\r\nSpinach,30\r\nCoriander,25\r\n';
    const result = parseCsv(csv);
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rows[1].name, 'Coriander');
  });

  await t.test('handles empty or malformed inputs without crashing', () => {
    assert.deepStrictEqual(parseCsv(''), { headers: [], rows: [] });
    assert.deepStrictEqual(parseCsv(null), { headers: [], rows: [] });
    assert.deepStrictEqual(parseCsv(undefined), { headers: [], rows: [] });
  });
});

test('CSV Utility - escapeCsvCell', async (t) => {
  await t.test('escapes commas and quotes according to RFC 4180', () => {
    assert.strictEqual(escapeCsvCell('Hello, World'), '"Hello, World"');
    assert.strictEqual(escapeCsvCell('Quote "test"'), '"Quote ""test"""');
    assert.strictEqual(escapeCsvCell('Simple'), 'Simple');
    assert.strictEqual(escapeCsvCell(null), '');
    assert.strictEqual(escapeCsvCell(undefined), '');
  });
});
