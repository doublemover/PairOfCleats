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
function readCurrentSource({ repoRoot, file }) {
  if (!repoRoot || !file) throw new Error('Exact source file and repository are required.');
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
    return { repoRoot: root, file: real, sourceHash: createHash('sha256').update(admitted).digest('hex'), byteLength: size, sourceText: decodeSource(admitted) };
  } finally { fs.closeSync(descriptor); }
}

function readVerifiedSource(options) {
  if (!/^[a-f0-9]{64}$/.test(options.sourceHash || '')) throw new Error('Exact source hash and repository are required.');
  const source = readCurrentSource(options);
  if (source.sourceHash !== options.sourceHash) throw new Error('Source differs from indexed evidence.');
  return source;
}

/** Text equality cannot bind a sibling/virtual document to an indexed file. */
function assertSourceUri(source, uri) {
  if (uri?.scheme !== 'file' || typeof uri.fsPath !== 'string' || !path.isAbsolute(uri.fsPath)
    || fs.realpathSync(uri.fsPath) !== source.file) {
    throw new Error('Opened document URI does not identify the qualified local source file.');
  }
}

/** Display must return the editor for the exact admitted opened document. */
function assertQualifiedEditor(editor, qualified) {
  if (!editor || editor.document !== qualified?.document) throw new Error('Displayed editor does not identify the qualified source document.');
  const document = qualified.document;
  if (document.isClosed === true || document.isDirty || document.version !== qualified.version) {
    throw new Error('Qualified source document changed before editor selection.');
  }
}

function sourceRangeOffsets(sourceText, range) {
  const starts = [0], ends = [];
  for (let offset = 0; offset < sourceText.length; offset++) {
    if (sourceText[offset] !== '\r' && sourceText[offset] !== '\n') continue;
    ends.push(offset);
    if (sourceText[offset] === '\r' && sourceText[offset + 1] === '\n') offset++;
    starts.push(offset + 1);
  }
  ends.push(sourceText.length);
  const at = (line, column) => {
    if (!Number.isSafeInteger(line) || line < 1 || line > starts.length
      || !Number.isSafeInteger(column) || column < 1) throw new Error('Indexed line/column is outside the qualified source.');
    const end = ends[line - 1];
    const offset = starts[line - 1] + column - 1;
    if (offset > end) throw new Error('Indexed column exceeds its qualified source line.');
    return offset;
  };
  const start = at(range.startLine, range.startCol), end = at(range.endLine, range.endCol);
  if (end < start) throw new Error('Indexed source range ends before it begins.');
  return { start, end };
}

/** Accept only an actually observed exact BOM/newline projection. Bare CR
 * replacement preserves length; removing CR from a CRLF pair does not. */
function sourceDocumentForm(sourceText, actual) {
  for (const bom of sourceText.startsWith('\ufeff') ? [0, 1] : [0]) {
    const text = sourceText.slice(bom);
    if (actual === text || actual === text.replace(/\r(?!\n)/g, '\n')) return { bom, crlf: false };
    if (actual === text.replace(/\r\n/g, '\n') || actual === text.replace(/\r\n?/g, '\n')) return { bom, crlf: true };
  }
  return null;
}

/** Qualify the actual buffer, then invert only observed BOM/newline changes. */
function documentOffsets(document, { sourceText, start, end }) {
  if (document.isDirty) throw new Error('The opened target buffer is dirty. Indexed ranges remain unavailable.');
  if (![start, end].every(Number.isSafeInteger) || start < 0 || end < start || end > sourceText.length) {
    throw new Error('Indexed span exceeds the exact source coordinate length.');
  }
  const form = sourceDocumentForm(sourceText, document.getText());
  if (!form) throw new Error('Opened target text differs beyond supported BOM/newline normalization.');
  const { bom, crlf } = form;
  const map = offset => {
    if (offset < bom || (sourceText[offset - 1] === '\r' && sourceText[offset] === '\n')) {
      throw new Error('Indexed boundary intersects a removed BOM or splits a CRLF line ending.');
    }
    const left = sourceText.charCodeAt(offset - 1), right = sourceText.charCodeAt(offset);
    if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) throw new Error('Indexed boundary splits a UTF-16 surrogate pair.');
    return offset - bom - (crlf ? (sourceText.slice(0, offset).match(/\r\n/g) || []).length : 0);
  };
  return { start: map(start), end: map(end) };
}

/** One native provider request owns this bounded document cache. No editor is
 * revealed; each returned location uses an actually opened, versioned buffer. */
function createDocumentAuthority({ workspace, isCurrent = () => true, maxDocuments = 25, requestedDocument = null }) {
  const sources = new Map();
  async function qualify({ repoRoot, file, uri, sourceHash, range, span = null, fileOnly = false }) {
    if (!isCurrent()) return null;
    if (typeof fileOnly !== 'boolean' || fileOnly && (range != null || span !== null)) throw new Error('File-only qualification cannot supply an indexed range or span.');
    const root = fs.realpathSync(repoRoot);
    const key = JSON.stringify([root, file, sourceHash]);
    if (!sources.has(key)) {
      if (sources.size >= maxDocuments) throw new Error('Native navigation document bound reached. Inspect the bounded indexed evidence instead.');
      sources.set(key, (async () => {
        const source = readVerifiedSource({ repoRoot: root, file, sourceHash });
        assertSourceUri(source, uri);
        const document = requestedDocument || await workspace.openTextDocument(uri);
        if (!isCurrent()) return null;
        assertSourceUri(source, document.uri);
        if (document.isClosed === true) throw new Error('Opened target document closed before location publication.');
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
    assertSourceUri(source, uri);
    assertSourceUri(source, source.document.uri);
    if (source.document.isClosed === true) throw new Error('Opened target document closed before location publication.');
    if (source.document.version !== source.version) throw new Error('Opened target version changed before location publication.');
    const offset = fileOnly && source.sourceText.startsWith('\ufeff') ? 1 : 0;
    const sourceSpan = fileOnly ? { start: offset, end: offset } : span || sourceRangeOffsets(source.sourceText, range);
    const offsets = documentOffsets(source.document, { ...source, ...sourceSpan });
    const originalSource = Object.freeze({ file: path.relative(source.repoRoot, source.file).split(path.sep).join('/'),
      contentDigest: source.sourceHash, byteLength: source.byteLength,
      span: Object.freeze({ start: Buffer.byteLength(source.sourceText.slice(0, sourceSpan.start)),
        end: Buffer.byteLength(source.sourceText.slice(0, sourceSpan.end)), unit: 'utf8-byte' }) });
    return { document: source.document, version: source.version, offsets, file: source.file, originalSource };
  }
  async function assertCurrent() {
    if (!isCurrent()) throw new Error('Navigation operation no longer owns publication.');
    await Promise.all([...sources.values()].map(async pending => {
      const source = await pending;
      if (source) {
        assertSourceUri(source, source.document.uri);
        if (source.document.isClosed === true) throw new Error('Opened target document closed before locations were published.');
        if (source.document.isDirty || source.document.version !== source.version) throw new Error('Target document changed before locations were published.');
        readVerifiedSource(source);
      }
    }));
    if (!isCurrent()) throw new Error('Navigation operation no longer owns publication.');
  }
  return { qualify, assertCurrent };
}

module.exports = { MAX_SOURCE_BYTES, decodeSource, readCurrentSource, readVerifiedSource, assertSourceUri, assertQualifiedEditor, sourceRangeOffsets,
  sourceDocumentForm, documentOffsets, createDocumentAuthority };
