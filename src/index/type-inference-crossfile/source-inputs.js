import path from 'node:path';
import { readContainedFile } from '../../shared/contained-file.js';
import { decodeTextBuffer } from '../../shared/encoding.js';
import { createXxhash64Hasher } from '../../shared/hash/xxhash-backend.js';
import { throwIfAborted } from '../../shared/abort.js';

const keyFor = file => String(file).replace(/\\/g, '/');
const invalidIdentity = file => Object.assign(new Error(`Cross-file source identities disagree for ${file}.`), {
  code: 'ERR_CROSS_FILE_SOURCE_IDENTITY'
});
const invalidRange = file => Object.assign(new Error(`Pinned cross-file chunk has an invalid UTF-16 source range: ${file}.`), {
  code: 'ERR_CROSS_FILE_SOURCE_RANGE'
});
const splitsSurrogate = (text, offset) => offset > 0 && offset < text.length
  && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
  && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff;

/** These are producer byte identities, never path/mtime substitutes. */
const parseIdentity = owner => {
  const hash = owner?.fileHash ?? null;
  const algorithm = owner?.fileHashAlgo ?? null;
  if (typeof hash !== 'string' || typeof algorithm !== 'string') return null;
  const normalizedAlgorithm = algorithm.toLowerCase();
  const width = { sha1: 40, sha256: 64, xxh64: 16 }[normalizedAlgorithm];
  if (!width || !new RegExp(`^[a-f0-9]{${width}}$`, 'i').test(hash)) return null;
  return { hash: hash.toLowerCase(), algorithm: normalizedAlgorithm };
};
export const resolveCrossFileSourceIdentity = chunk => {
  const direct = parseIdentity(chunk), nested = parseIdentity(chunk?.metaV2);
  if (direct && nested && (direct.hash !== nested.hash || direct.algorithm !== nested.algorithm)) {
    throw invalidIdentity(chunk.file || '<unknown>');
  }
  // Never construct one claimed identity by taking its hash from one producer
  // handoff and its algorithm from another incomplete handoff.
  return chunk?.fileHash != null || chunk?.fileHashAlgo != null ? direct : nested;
};

export const collectCrossFileSourceInputs = chunks => {
  const files = new Map();
  let qualified = true;
  for (const chunk of chunks) {
    if (!chunk?.file) { qualified = false; continue; }
    const file = keyFor(chunk.file);
    const identity = resolveCrossFileSourceIdentity(chunk);
    const previous = files.get(file);
    if (identity && previous?.identity && (identity.hash !== previous.identity.hash
      || identity.algorithm !== previous.identity.algorithm)) throw invalidIdentity(file);
    files.set(file, { identity: identity || previous?.identity || null,
      qualified: Boolean(identity) && previous?.qualified !== false });
    if (!identity) qualified = false;
  }
  return { files, qualified };
};

/** One bounded verified capture per file; decoding uses the same encoding owner
 * as Stage1. Legacy inputs may be read but cannot authorize output replay. */
export const createCrossFileSourceReader = ({ rootDir, chunks, signal = null,
  read = readContainedFile }) => {
  const inputs = collectCrossFileSourceInputs(chunks);
  const fileTextByFile = new Map();
  const unavailable = new Set();
  const reasons = Object.create(null);
  let readFiles = 0;
  const getText = async relative => {
    if (!relative) return '';
    throwIfAborted(signal);
    const file = keyFor(relative);
    if (fileTextByFile.has(file)) return fileTextByFile.get(file);
    const input = inputs.files.get(file);
    if (!input) throw Object.assign(new Error(`Cross-file source is outside the admitted chunk inventory: ${file}`), {
      code: 'ERR_CROSS_FILE_SOURCE_SCOPE'
    });
    const identity = input?.identity || null;
    let buffer;
    try {
      buffer = await read(rootDir, path.resolve(rootDir, file), {
        ...(identity && identity.algorithm !== 'xxh64'
          ? { expectedHash: identity.hash, hashAlgorithm: identity.algorithm } : {}), signal
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (identity) throw Object.assign(new Error(`Pinned cross-file source is missing: ${file}`, { cause: error }), {
        code: 'ERR_CROSS_FILE_SOURCE_MISSING'
      });
      unavailable.add(file);
      reasons.source_missing = (reasons.source_missing || 0) + 1;
      fileTextByFile.set(file, '');
      return '';
    }
    throwIfAborted(signal);
    if (identity?.algorithm === 'xxh64') {
      const hasher = await createXxhash64Hasher();
      hasher.update(buffer);
      if (hasher.digest() !== identity.hash) throw Object.assign(new Error(`Cross-file source checksum mismatch: ${file}`), {
        code: 'ERR_FILE_INTEGRITY'
      });
    }
    const { text } = decodeTextBuffer(buffer, { filePath: file });
    throwIfAborted(signal);
    fileTextByFile.set(file, text);
    readFiles += 1;
    return text;
  };
  const coverage = () => ({
    status: inputs.qualified && !unavailable.size ? 'qualified' : 'unqualified',
    inputFiles: inputs.files.size,
    qualifiedFiles: [...inputs.files.values()].reduce((count, input) => count + Number(input.qualified), 0),
    readFiles, unavailableFiles: unavailable.size,
    reasons: { ...(!inputs.qualified ? { source_identity_unavailable: 1 } : {}), ...reasons }
  });
  const getChunkText = async chunk => {
    if (!chunk?.file) return '';
    const file = keyFor(chunk.file), start = chunk.start, end = chunk.end;
    const pinned = Boolean(inputs.files.get(file)?.identity);
    if (pinned && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 0 || end < start)) throw invalidRange(file);
    const text = await getText(file);
    throwIfAborted(signal);
    if (pinned && (end > text.length
      || splitsSurrogate(text, start) || splitsSurrogate(text, end))) throw invalidRange(file);
    // Legacy unpinned reads keep their historical slice behavior, but their
    // existing unqualified coverage cannot authorize output replay.
    return text.slice(start, end);
  };
  return { getText, getChunkText, fileTextByFile, coverage };
};
