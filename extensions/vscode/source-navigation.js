const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');

function sourceNavigationArgs(document, position, includeDeclaration = true) {
  if (!document?.uri?.fsPath || !position || document.isDirty) {
    throw new Error('PairOfCleats indexed navigation requires a saved source document. Use Related Search for approximate matches.');
  }
  const bytes = fs.readFileSync(document.uri.fsPath);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('Source exceeds the bounded editor navigation verifier.');
  const disk = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const text = document.getText();
  const normalized = disk.replace(/\r\n/g, '\n');
  const removedBom = disk.startsWith('\ufeff') && (text === disk.slice(1) || text === normalized.slice(1));
  if (text !== disk && text !== normalized && !removedBom) {
    throw new Error('The document differs from disk. Save it before indexed navigation.');
  }
  if (!Number.isSafeInteger(position.line) || !Number.isSafeInteger(position.character)
    || position.line < 0 || position.character < 0) throw new Error('Invalid navigation cursor.');
  return ['--source-hash', createHash('sha256').update(bytes).digest('hex'),
    '--source-version', String(document.version ?? 0), '--coordinate-unit', 'utf16',
    '--line', String(position.line + 1), '--column', String(position.character + 1 + (removedBom && position.line === 0 ? 1 : 0)),
    '--include-declaration', String(includeDeclaration !== false)];
}

function qualifiedNavigationRows(payload) {
  if (payload?.status !== 'resolved' || payload?.binding?.status !== 'resolved') return [];
  const rows = payload.results;
  if (!Array.isArray(rows)) return [];
  const valid = row => row.coordinateUnit === 'utf16'
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
