const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { readCurrentSource, assertSourceUri, sourceRangeOffsets, sourceDocumentForm } = require('./document-authority.js');

function sourceNavigationArgs(document, position, includeDeclaration = true, repoRoot = null) {
  if (!document?.uri?.fsPath || !position || document.isDirty) {
    throw new Error('PairOfCleats indexed navigation requires a saved source document. Use Related Search for approximate matches.');
  }
  const captured = readCurrentSource({ repoRoot: repoRoot || path.dirname(document.uri.fsPath), file: document.uri.fsPath });
  assertSourceUri(captured, document.uri);
  if (document.isClosed === true) throw new Error('Indexed navigation requires an opened saved source document.');
  const disk = captured.sourceText;
  const text = document.getText();
  const form = sourceDocumentForm(disk, text);
  if (!form) {
    throw new Error('The document differs from disk. Save it before indexed navigation.');
  }
  if (!Number.isSafeInteger(position.line) || !Number.isSafeInteger(position.character)
    || position.line < 0 || position.character < 0) throw new Error('Invalid navigation cursor.');
  const line = position.line + 1, column = position.character + 1 + (form.bom && position.line === 0 ? 1 : 0);
  const span = sourceRangeOffsets(disk, { startLine: line, startCol: column, endLine: line, endCol: column });
  const left = disk.charCodeAt(span.start - 1), right = disk.charCodeAt(span.start);
  if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) throw new Error('Navigation cursor splits a UTF-16 surrogate pair.');
  return ['--source-hash', captured.sourceHash,
    '--source-version', String(document.version ?? 0), '--coordinate-unit', 'utf16',
    '--line', String(line), '--column', String(column),
    '--include-declaration', String(includeDeclaration !== false)];
}

function qualifiedNavigationRows(payload) {
  if (payload?.status !== 'resolved' || payload?.binding?.status !== 'resolved') return [];
  const rows = payload.results;
  if (!Array.isArray(rows)) return [];
  const valid = row => row && typeof row === 'object' && row.coordinateUnit === 'utf16'
    && /^[a-f0-9]{64}$/.test(row.sourceHash || '') && Number.isSafeInteger(row.startLine)
    && Number.isSafeInteger(row.startCol) && Number.isSafeInteger(row.endLine)
    && Number.isSafeInteger(row.endCol) && row.startLine >= 1 && row.startCol >= 1
    && row.endLine >= row.startLine && row.endCol >= 1
    && (row.endLine !== row.startLine || row.endCol >= row.startCol);
  return rows.every(valid) ? rows : [];
}

function verifyLocationSource(file, sourceHash) {
  if (!file || !/^[a-f0-9]{64}$/.test(sourceHash || '')) return false;
  try {
    if (fs.statSync(file).size > 4 * 1024 * 1024) return false;
    const bytes = fs.readFileSync(file);
    // A native Location has no opened-document normalization witness. Keep
    // BOM-bearing targets unavailable until that host offset mapping exists.
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return false;
    return createHash('sha256').update(bytes).digest('hex') === sourceHash;
  } catch { return false; }
}

module.exports = { sourceNavigationArgs, qualifiedNavigationRows, verifyLocationSource };
