import { getSummaryCache } from './cache.js';
import { buildLocalCacheKey } from '../../shared/cache-key.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { createRenderSourceReader, isRenderSourceReader, MAX_RENDER_SCAN_CHARS } from './source-snapshot.js';

const summaries = new WeakSet();
const MAX_SUMMARY_CHARS = 4096;
const missing = (reason, errorCode = null) => Object.freeze({ state: 'unavailable', reason, errorCode,
  text: '(Could not load summary)', selectionComplete: false });
const clip = (text, length) => {
  let end = Math.max(0, length);
  if (end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
  return text.slice(0, end);
};

/** Summaries consume the same admitted, stable source as previews. A retention
 * cache hit cannot reopen a refused source or grant additional scan work.
 */
export function getBodySummaryResult(rootDir, chunk, maxWords = 80, { sourceReader = null } = {}) {
  try {
    const wordLimit = Math.max(0, Math.min(80, Math.trunc(Number(maxWords) || 0)));
    if (wordLimit === 0) return Object.freeze({ state: 'inactive', reason: 'zero-word-limit', text: '', selectionComplete: true });
    const owner = sourceReader || createRenderSourceReader(rootDir);
    if (!isRenderSourceReader(owner, rootDir)) return missing('invalid-source-owner');
    const source = owner.read(chunk);
    if (source.state !== 'available') return missing(source.reason, source.errorCode);
    const snapshot = source.snapshot;
    const key = buildLocalCacheKey({ namespace: 'summary-owned-source-v1', payload: {
      source: snapshot.key, start: chunk.start, end: chunk.end, wordLimit
    } }).key;
    const cache = getSummaryCache(), cached = cache.get(key);
    if (summaries.has(cached) && cached.key === key) return cached;
    const end = Math.min(chunk.end, snapshot.text.length);
    if (chunk.start >= end) return missing('selected-span-outside-source');
    const scanEnd = Math.min(end, chunk.start + MAX_RENDER_SCAN_CHARS);
    if (!owner.admitScan(scanEnd - chunk.start)) return missing('summary-scan-budget');
    const raw = snapshot.text.slice(chunk.start, scanEnd), words = [];
    let cursor = 0, outputChars = 0;
    const finish = (state, reason) => {
      if (chunk.end > snapshot.text.length && state === 'available') { state = 'truncated'; reason = 'selected-span-incomplete'; }
      const joined = words.join(' ');
      const result = Object.freeze({ key, state, reason, text: state === 'truncated' ? clip(joined, joined.length) : joined, wordCount: words.length,
        selectionComplete: state === 'available' });
      if (state === 'available') { summaries.add(result); cache.set(key, result); }
      return result;
    };
    while (cursor < raw.length) {
      const newline = raw.indexOf('\n', cursor), lineEnd = newline < 0 ? raw.length : newline;
      const line = raw.slice(cursor, lineEnd);
      // Reserve upper bounds for trim, comment-prefix normalization and word
      // scanning before those operations, separately from output word/char caps.
      if (!owner.admitScan(line.length * 3)) return finish('truncated', 'summary-scan-budget');
      let cleaned = line.trim();
      if (cleaned === '/*' || cleaned === '/**' || cleaned.startsWith('*/')) cleaned = '';
      else if (cleaned.startsWith('/*')) cleaned = cleaned.replace(/^\/\*+\s?/u, '');
      else if (cleaned.startsWith('*')) cleaned = cleaned.replace(/^\*\s?/u, '');
      const clippedTail = scanEnd < end && lineEnd === raw.length && line.length > 0 && !/\s$/u.test(line);
      for (const match of cleaned.matchAll(/\S+/gu)) {
        const word = match[0], remaining = MAX_SUMMARY_CHARS - outputChars - (words.length ? 1 : 0);
        if (word.length > remaining) {
          const prefix = remaining > 0 ? clip(word, remaining) : '';
          if (prefix) words.push(prefix);
          return finish('truncated', 'summary-character-limit');
        }
        words.push(word); outputChars += word.length + (words.length > 1 ? 1 : 0);
        if (clippedTail && match.index + word.length === cleaned.length) return finish('truncated', 'summary-scan-limit');
        if (words.length === wordLimit) return finish('available', 'word-limit');
      }
      cursor = lineEnd + 1;
    }
    return finish(scanEnd < end ? 'truncated' : 'available', scanEnd < end ? 'summary-scan-limit' : 'selected-span-end');
  } catch (error) {
    observeStorageResource(error, { phase: 'body-summary' }).requireSettled();
    return missing('summary-unavailable');
  }
}

export function getBodySummary(rootDir, chunk, maxWords = 80, options = {}) {
  const result = getBodySummaryResult(rootDir, chunk, maxWords, options);
  return result.state === 'truncated' ? `${result.text}… [partial summary]` : result.text;
}
