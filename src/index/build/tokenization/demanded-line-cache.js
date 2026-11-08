import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../../shared/abort.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { normalizeDictSegmentation } from '../../../shared/tokenize-dictionary.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../semantic/analysis-versions.js';
import { SYN } from '../../constants.js';
import { buildTokenSequence } from './sequence.js';
import { createFileLineTokenStreamInternal, sliceFileLineTokenStreamInternal } from './stream-helpers.js';

const hash = value => createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
const digest = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
const arrayBytes = values => 64 + values.reduce((sum, value) => sum + 8 + value.length * 2, 0);
const fail = message => Object.assign(new Error(message), { code: 'ERR_LINE_TOKEN_CACHE_RESERVATION' });

/** File-local, demanded complete lines only. Reservations include retained and
 * active products plus the window handoff. Unadmitted work falls back to the
 * caller's exact chunk tokenizer; unexpected producer failures still fail.
 */
export const createDemandedLineTokenCache = ({ text, lineIndex, sourceIdentity, signal = null,
  maxBytes = 8 * 1024 * 1024, maxEntries = 512, tokenize = buildTokenSequence, metrics = {} } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 32 * 1024 * 1024
    || !Number.isSafeInteger(maxEntries) || maxEntries < 0 || maxEntries > 2048
    || typeof tokenize !== 'function') throw new TypeError('Invalid demanded-line cache bounds.');
  const entries = new Map(), dictionaries = new WeakMap();
  const sourceId = Object.freeze({ hash: sourceIdentity?.hash, algorithm: sourceIdentity?.algorithm });
  let dictionaryCounter = 0, retainedBytes = 0, reservedBytes = 0, activeBytes = 0, closed = false, working = false;
  const stats = { accounting: 'logical-block-bytes-and-preparation-reservations', capacityBytes: maxBytes,
    requestedWindows: 0, completedWindows: 0, preparedLines: 0, preparedChars: 0,
    inspectedChars: 0, reusedLines: 0, evictions: 0, peakRetainedBytes: 0, peakWorkingBytes: 0,
    preparationFailures: 0, refusals: Object.create(null), retainedBytes: 0, reservedBytes: 0, activeBytes: 0 };
  const publish = () => {
    stats.retainedBytes = retainedBytes; stats.reservedBytes = reservedBytes; stats.activeBytes = activeBytes;
    stats.peakRetainedBytes = Math.max(stats.peakRetainedBytes, retainedBytes);
    stats.peakWorkingBytes = Math.max(stats.peakWorkingBytes, retainedBytes + reservedBytes + activeBytes);
    Object.assign(metrics, stats, { closed, refusals: { ...stats.refusals } });
  };
  const refuse = reason => { stats.refusals[reason] = (stats.refusals[reason] || 0) + 1; publish(); return null; };
  const remove = key => {
    const entry = entries.get(key);
    if (!entry) return;
    retainedBytes -= entry.bytes; entries.delete(key); stats.evictions++;
  };
  const ready = typeof text === 'string' && Array.isArray(lineIndex) && lineIndex[0] === 0
    && digest(sourceId.hash) && ['sha1', 'sha256'].includes(sourceId.algorithm)
    && sourceId.hash.length === (sourceId.algorithm === 'sha1' ? 40 : 64);
  const trySliceImpl = ({ startLine, endLine, mode, ext = '', languageId = null, dictWords, dictConfig = {}, dictionaryReceipt } = {}) => {
    if (closed) throw new Error('Demanded-line cache is closed.');
    throwIfAborted(signal); stats.requestedWindows++;
    if (!ready || !digest(dictionaryReceipt)) return refuse('source-or-dictionary-receipt-unavailable');
    if (!['code', 'prose'].includes(mode) || !dictWords || typeof dictWords.has !== 'function'
      || typeof ext !== 'string' || ext.length > 64 || languageId !== null && (typeof languageId !== 'string' || languageId.length > 128)
      || !Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine
      || endLine > lineIndex.length || endLine - startLine >= 128) return refuse('window-ineligible');
    if (!maxBytes || !maxEntries) return refuse('admission-closed');
    let dictionaryId = dictionaries.get(dictWords);
    if (!dictionaryId) { dictionaryId = ++dictionaryCounter; dictionaries.set(dictWords, dictionaryId); }
    const profile = hash({ sourceIdentity: sourceId, mode, ext: String(ext).toLowerCase(), languageId, dictionaryReceipt,
      dictionaryId, segmentation: normalizeDictSegmentation(dictConfig),
      lexicalAnalyzer: SEMANTIC_ANALYSIS_VERSIONS.lexicalAnalyzer, policy: 'demanded-lines-v1' });
    const window = [], missing = [], pinned = new Set();
    let inputChars = 0, preparationReservation = 0, outputReservation = 128, synonymChars = 0;
    let synonymEntries = 0;
    for (const key in SYN) if (Object.hasOwn(SYN, key)) {
      if (++synonymEntries > 1024) return refuse('synonym-policy-unavailable');
      const value = Object.getOwnPropertyDescriptor(SYN, key);
      if (!value || !Object.hasOwn(value, 'value')) return refuse('synonym-policy-unavailable');
      if (typeof value.value === 'string') synonymChars = Math.max(synonymChars, value.value.length);
    }
    for (let line = startLine; line <= endLine; line++) {
      throwIfAborted(signal);
      const start = lineIndex[line - 1], rawEnd = lineIndex[line] ?? text.length;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(rawEnd) || start < 0 || rawEnd < start || rawEnd > text.length
        || rawEnd === start && !(start === text.length && line === lineIndex.length)
        || start > 0 && text.charCodeAt(start - 1) !== 10
        || rawEnd < text.length && text.charCodeAt(rawEnd - 1) !== 10) return refuse('line-index-ineligible');
      const end = rawEnd > start && text.charCodeAt(rawEnd - 1) === 10 ? rawEnd - 1 : rawEnd;
      const chars = end - start;
      inputChars += chars;
      if (chars > 8192 || inputChars > 16384) return refuse('input-byte-admission');
      const key = `${profile}:${start}:${end}`, cached = entries.get(key);
      if (cached) {
        pinned.add(key); window.push(cached);
        const count = cached.tokens.length + (cached.punctuation?.length || 0);
        const characters = cached.tokens.reduce((n, token) => n + token.length, 0)
          + (cached.punctuation?.reduce((n, token) => n + token.length, 0) || 0);
        outputReservation += count * (24 + 2 * synonymChars) + 4 * characters + 128;
        continue;
      }
      let expansion = 1;
      for (let offset = start; offset < end; offset++) {
        stats.inspectedChars++;
        const char = text.charCodeAt(offset);
        if (char === 10) return refuse('line-index-ineligible');
        if (char > 127) expansion = 18;
      }
      const estimate = 512 + chars * (expansion === 1 ? 96 : 1024);
      preparationReservation += estimate;
      outputReservation += 128 + chars * expansion * (4 * (24 + 2 * synonymChars) + 16);
      const selected = { key, line, start, end, rawEnd, chars, estimate };
      window.push(selected); missing.push(selected);
    }
    if (inputChars > 16384) return refuse('input-byte-admission');
    const held = [...pinned].reduce((sum, key) => sum + entries.get(key).bytes, 0);
    if (held + preparationReservation + outputReservation > maxBytes || window.length > maxEntries) return refuse('working-byte-admission');
    for (const key of entries.keys()) {
      if (retainedBytes + preparationReservation + outputReservation <= maxBytes && entries.size + missing.length <= maxEntries) break;
      if (!pinned.has(key)) remove(key);
    }
    reservedBytes = preparationReservation + outputReservation; publish();
    const prepared = new Map();
    try {
      for (const selected of missing) {
        throwIfAborted(signal);
        const built = createFileLineTokenStreamInternal({ text: text.slice(selected.start, selected.end), mode, ext, dictWords, dictConfig }, input => {
          const result = tokenize(input);
          if (!Array.isArray(result?.tokens) || !result.tokens.every(token => typeof token === 'string')) {
            throw fail('Line producer returned invalid tokens.');
          }
          return result;
        });
        throwIfAborted(signal);
        if (closed) throw new Error('Demanded-line cache closed during preparation.');
        if (built.lineTokens.length !== 1 || !built.lineTokens[0].every(token => typeof token === 'string')
          || built.linePunctuationTokens && !built.linePunctuationTokens[0].every(token => typeof token === 'string')) throw fail('Line producer returned an invalid complete-line product.');
        const tokens = Object.freeze(built.lineTokens[0].slice());
        const punctuation = built.linePunctuationTokens ? Object.freeze(built.linePunctuationTokens[0].slice()) : null;
        const bytes = 256 + arrayBytes(tokens) + (punctuation ? arrayBytes(punctuation) : 0);
        if (bytes > selected.estimate) throw fail('Line output exceeds its admitted preparation estimate.');
        const block = Object.freeze({ key: selected.key, chars: selected.chars, rawEnd: selected.rawEnd,
          tokens, punctuation, punctuationTruncated: built.linePunctuationTruncated?.[0] || 0, bytes });
        prepared.set(selected.key, block);
        reservedBytes -= selected.estimate; activeBytes += bytes;
        stats.preparedLines++; stats.preparedChars += selected.chars; publish();
      }
      throwIfAborted(signal);
      const blocks = window.map(selected => prepared.get(selected.key) || selected);
      const payload = sliceFileLineTokenStreamInternal({ stream: {
        lineTokens: blocks.map(block => block.tokens),
        linePunctuationTokens: mode === 'code' ? blocks.map(block => block.punctuation) : null,
        linePunctuationTruncated: mode === 'code' ? Uint8Array.from(blocks.map(block => block.punctuationTruncated)) : null
      }, startLine: 1, endLine: blocks.length });
      throwIfAborted(signal);
      if (closed) throw new Error('Demanded-line cache closed during handoff.');
      if (arrayBytes(payload.tokens) + arrayBytes(payload.seq) > outputReservation) throw fail('Window output exceeds its admitted handoff estimate.');
      for (const block of blocks) {
        if (prepared.has(block.key)) retainedBytes += block.bytes;
        entries.delete(block.key); entries.set(block.key, block);
      }
      activeBytes = 0; reservedBytes = 0;
      stats.completedWindows++; stats.reusedLines += pinned.size; publish();
      return payload;
    } catch (error) { stats.preparationFailures++; throw error; }
    finally { activeBytes = 0; reservedBytes = 0; publish(); }
  };
  const clear = () => { entries.clear(); retainedBytes = 0; activeBytes = 0; reservedBytes = 0; text = null; lineIndex = null; };
  const trySlice = input => {
    if (working) throw new Error('Demanded-line cache cannot prepare reentrant windows.');
    working = true;
    try { return trySliceImpl(input); }
    finally { working = false; if (closed) clear(); publish(); }
  };
  publish();
  return Object.freeze({ trySlice,
    retireBefore(offset) {
      if (working) throw new Error('Demanded-line cache cannot retire during preparation.');
      if (!Number.isSafeInteger(offset) || offset < 0) return;
      for (const [key, block] of entries) if (block.rawEnd <= offset) remove(key);
      publish();
    },
    stats: () => Object.freeze({ ...stats, closed, refusals: Object.freeze({ ...stats.refusals }) }),
    close() { if (!closed) { closed = true; if (!working) clear(); publish(); } }
  });
};
