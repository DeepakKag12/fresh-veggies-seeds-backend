/**
 * RFC 4180 compliant CSV parser and generator utility (FEAT-018)
 * Handles quoted cells, escaped quotes (""), newlines within cells, and trimming.
 */

/**
 * Parse raw CSV string into an array of row objects keyed by normalized headers.
 * @param {string} csvText
 * @returns {{ headers: string[], rows: Array<Record<string, string>> }}
 */
function parseCsv(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    return { headers: [], rows: [] };
  }

  // Normalize CRLF to LF
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote: "" -> "
        currentField += '"';
        i++; // skip next quote
      } else {
        // Toggle quote mode
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentLine.push(currentField.trim());
      currentField = '';
    } else if (char === '\n' && !insideQuotes) {
      currentLine.push(currentField.trim());
      // Skip trailing empty line
      if (currentLine.some((field) => field !== '')) {
        lines.push(currentLine);
      }
      currentLine = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  // Push last field if present
  if (currentField.length > 0 || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    if (currentLine.some((field) => field !== '')) {
      lines.push(currentLine);
    }
  }

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // First line is headers
  const rawHeaders = lines[0];
  const headers = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const rowValues = lines[i];
    const rowObj = {};
    headers.forEach((header, index) => {
      rowObj[header] = rowValues[index] !== undefined ? rowValues[index] : '';
    });
    // Also store original row index for error reporting (1-indexed, line 1 is header, so row 2 is index 1)
    rowObj.__rowNumber = i + 1;
    rows.push(rowObj);
  }

  return { headers: rawHeaders, rows };
}

/**
 * Escape a single CSV cell value according to RFC 4180
 * @param {any} value
 * @returns {string}
 */
function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate a CSV string from an array of headers and row objects
 * @param {string[]} headers
 * @param {Array<Record<string, any>>} rows
 * @returns {string}
 */
function generateCsv(headers, rows) {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLines = rows.map((row) => {
    return headers.map((h) => escapeCsvCell(row[h])).join(',');
  });
  return [headerLine, ...rowLines].join('\r\n');
}

module.exports = {
  parseCsv,
  escapeCsvCell,
  generateCsv,
};
