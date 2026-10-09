import { historyError } from './common.js';
export const HISTORY_SEARCH_VERSION = 'history-search.v2';
const words = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
export function parseHistoryQuery(query) {
  if (typeof query !== 'string' || query.length > 4096 || (query.match(/"/g)?.length ?? 0) % 2) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Use a bounded query with balanced quotes.');
  }
  const positive = [], excluded = [], phrases = [];
  for (const match of query.matchAll(/"([^"]*)"|(-?[\p{L}\p{N}_]+)/gu)) {
    if (match[1] !== undefined) {
      const phrase = words(match[1]);
      if (!phrase.length) throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Empty quoted phrase.');
      phrases.push(phrase); positive.push(...phrase);
    } else {
      const negative = match[2].startsWith('-') && (match.index === 0 || /\s/.test(query[match.index - 1]));
      (negative ? excluded : positive).push(...words(match[2]));
    }
  }
  const tokens = [...new Set(positive)];
  if (!tokens.length || tokens.length + new Set(excluded).size > 32) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Use 1 to 32 query words with at least one positive term.');
  }
  return { tokens, excluded: [...new Set(excluded)], phrases };
}
export function matchesHistoryQuery(text, parsed, mode) {
  const sequence = words(text), present = new Set(sequence);
  if (parsed.excluded.some(token => present.has(token))) return false;
  if (parsed.phrases.some(phrase => !sequence.some((_, index) =>
    phrase.every((token, offset) => sequence[index + offset] === token)))) return false;
  return mode === 'relaxed' ? parsed.tokens.some(token => present.has(token))
    : parsed.tokens.every(token => present.has(token));
}
