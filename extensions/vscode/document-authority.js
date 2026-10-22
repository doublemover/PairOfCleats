const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const decodeSource = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const contained = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

/** Read exact original bytes under the selected local workspace authority. */
function readVerifiedSource({ repoRoot, file, sourceHash }) {
  if (!repoRoot || !file || !/^[a-f0-9]{64}$/.test(sourceHash || '')) throw new Error('Exact source hash and repository are required.');
  const root = fs.realpathSync(repoRoot), real = fs.realpathSync(file);
  if (!contained(root, real)) throw new Error('Indexed source resolves outside the selected repository.');
  const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(real, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size > MAX_SOURCE_BYTES) throw new Error('Indexed source exceeds the 4 MiB document verifier.');
    const bytes = Buffer.alloc(Math.min(before.size + 1, MAX_SOURCE_BYTES + 1));
    let size = 0;
    while (size < bytes.length) {
      const read = fs.readSync(descriptor, bytes, size, bytes.length - size, size);
      if (!read) break;
      size += read;
    }
    const after = fs.fstatSync(descriptor), current = fs.statSync(real);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || current.dev !== after.dev || current.ino !== after.ino
      || current.size !== after.size || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs
      || fs.realpathSync(file) !== real || !contained(root, fs.realpathSync(file))) {
      throw new Error('Source changed while its exact bytes were being verified.');
    }
    const admitted = bytes.subarray(0, size);
    if (createHash('sha256').update(admitted).digest('hex') !== sourceHash) throw new Error('Source differs from indexed evidence.');
    return { file: real, sourceHash, sourceText: decodeSource(admitted) };
  } finally { fs.closeSync(descriptor); }
}

function sourceRangeOffsets(sourceText, range) {
  const starts = [0];
  for (let offset = sourceText.indexOf('\n'); offset >= 0; offset = sourceText.indexOf('\n', offset + 1)) starts.push(offset + 1);
  const at = (line, column) => {
    if (!Number.isSafeInteger(line) || line < 1 || line > starts.length
      || !Number.isSafeInteger(column) || column < 1) throw new Error('Indexed line/column is outside the qualified source.');
    let end = line < starts.length ? starts[line] - 1 : sourceText.length;
    if (sourceText[end - 1] === '\r' && sourceText[end] === '\n') end -= 1;
    const offset = starts[line - 1] + column - 1;
    if (offset > end) throw new Error('Indexed column exceeds its qualified source line.');
    return offset;
  };
  const start = at(range.startLine, range.startCol), end = at(range.endLine, range.endCol);
  if (end < start) throw new Error('Indexed source range ends before it begins.');
  return { start, end };
}

/** Qualify the actual buffer, then invert only observed BOM/CRLF changes. */
function documentOffsets(document, { sourceText, start, end }) {
  if (document.isDirty) throw new Error('The opened target buffer is dirty. Indexed ranges remain unavailable.');
  if (![start, end].every(Number.isSafeInteger) || start < 0 || end < start || end > sourceText.length) {
    throw new Error('Indexed span exceeds the exact source coordinate length.');
  }
  const actual = document.getText();
  let bom = 0, crlf = false;
  if (actual !== sourceText) {
    if (sourceText.startsWith('\ufeff') && actual === sourceText.slice(1)) bom = 1;
    else if (actual === sourceText.replace(/\r\n/g, '\n')) crlf = true;
    else if (sourceText.startsWith('\ufeff') && actual === sourceText.slice(1).replace(/\r\n/g, '\n')) {
      bom = 1; crlf = true;
    } else throw new Error('Opened target text differs beyond supported BOM/CRLF normalization.');
  }
  const map = offset => {
    if (offset < bom || (crlf && sourceText[offset - 1] === '\r' && sourceText[offset] === '\n')) {
      throw new Error('Indexed boundary intersects a character removed by document normalization.');
    }
    const left = sourceText.charCodeAt(offset - 1), right = sourceText.charCodeAt(offset);
    if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) throw new Error('Indexed boundary splits a UTF-16 surrogate pair.');
    return offset - bom - (crlf ? (sourceText.slice(0, offset).match(/\r\n/g) || []).length : 0);
  };
  return { start: map(start), end: map(end) };
}

/** One native provider request owns this bounded document cache. No editor is
 * revealed; each returned location uses an actually opened, versioned buffer. */
function createDocumentAuthority({ workspace, isCurrent = () => true, maxDocuments = 25 }) {
  const sources = new Map();
  async function qualify({ repoRoot, file, uri, sourceHash, range }) {
    if (!isCurrent()) return null;
    const key = `${file}\0${sourceHash}`;
    if (!sources.has(key)) {
      if (sources.size >= maxDocuments) throw new Error('Native navigation document bound reached. Inspect the bounded indexed evidence instead.');
      sources.set(key, (async () => {
        const source = readVerifiedSource({ repoRoot, file, sourceHash });
        const document = await workspace.openTextDocument(uri);
        if (!isCurrent()) return null;
        const version = document.version;
        // Re-read through the same contained-byte authority after the await.
        readVerifiedSource({ repoRoot, file, sourceHash });
        documentOffsets(document, { ...source, start: source.sourceText.startsWith('\ufeff') ? 1 : 0,
          end: source.sourceText.startsWith('\ufeff') ? 1 : 0 });
        return { ...source, document, version };
      })());
    }
    const source = await sources.get(key);
    if (!source || !isCurrent()) return null;
    if (source.document.version !== source.version) throw new Error('Opened target version changed before location publication.');
    const span = sourceRangeOffsets(source.sourceText, range);
    const offsets = documentOffsets(source.document, { ...source, ...span });
    return { document: source.document, version: source.version, offsets, file: source.file };
  }
  function assertCurrent() {
    if (!isCurrent()) throw new Error('Navigation operation no longer owns publication.');
    return Promise.all([...sources.values()].map(async pending => {
      const source = await pending;
      if (source && (source.document.isDirty || source.document.version !== source.version)) throw new Error('Target document changed before locations were published.');
    }));
  }
  return { qualify, assertCurrent };
}

module.exports = { MAX_SOURCE_BYTES, decodeSource, readVerifiedSource, sourceRangeOffsets,
  documentOffsets, createDocumentAuthority };
