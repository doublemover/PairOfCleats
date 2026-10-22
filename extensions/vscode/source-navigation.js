const fs = require('node:fs');
const { createHash } = require('node:crypto');

function sourceNavigationArgs(document, position, includeDeclaration = true) {
  if (!document?.uri?.fsPath || !position || document.isDirty) {
    throw new Error('PairOfCleats indexed navigation requires a saved source document. Use Related Search for approximate matches.');
  }
  const bytes = fs.readFileSync(document.uri.fsPath);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('Source exceeds the bounded editor navigation verifier.');
  const disk = bytes.toString('utf8');
  const text = document.getText();
  if (text !== disk && !(disk.startsWith('\ufeff') && text === disk.slice(1))) {
    throw new Error('The document differs from disk. Save it before indexed navigation.');
  }
  if (!Number.isSafeInteger(position.line) || !Number.isSafeInteger(position.character)
    || position.line < 0 || position.character < 0) throw new Error('Invalid navigation cursor.');
  return ['--source-hash', createHash('sha256').update(bytes).digest('hex'),
    '--source-version', String(document.version ?? 0), '--coordinate-unit', 'utf16',
    '--line', String(position.line + 1), '--column', String(position.character + 1),
    '--include-declaration', String(includeDeclaration !== false)];
}

function qualifiedNavigationRows(payload) {
  if (payload?.status !== 'resolved' || payload?.binding?.status !== 'resolved') return [];
  return (payload.results || []).filter(row => row.coordinateUnit === 'utf16'
    && /^[a-f0-9]{64}$/.test(row.sourceHash || '') && Number.isSafeInteger(row.startLine)
    && Number.isSafeInteger(row.startCol) && Number.isSafeInteger(row.endLine)
    && Number.isSafeInteger(row.endCol));
}

function verifyLocationSource(file, sourceHash) {
  if (!file || !/^[a-f0-9]{64}$/.test(sourceHash || '')) return false;
  try {
    if (fs.statSync(file).size > 4 * 1024 * 1024) return false;
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex') === sourceHash;
  } catch { return false; }
}

module.exports = { sourceNavigationArgs, qualifiedNavigationRows, verifyLocationSource };
