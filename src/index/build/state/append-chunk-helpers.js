import { ALLOWED_CHARGRAM_FIELDS } from './postings-helpers.js';

export const DEFAULT_CHARGRAM_FIELDS = Object.freeze(['name', 'doc']);
export const PHRASE_SOURCE_FIELDS = Object.freeze(['name', 'signature', 'doc', 'comment']);
export const BASE_FIELD_POSTINGS_FIELDS = Object.freeze(['name', 'signature', 'doc', 'comment', 'body']);
export const CLASSIFIED_FIELD_POSTINGS_FIELDS = Object.freeze([
  ...BASE_FIELD_POSTINGS_FIELDS,
  'keyword',
  'operator',
  'literal'
]);

export const resolveBoundedNgramRange = (rawMin, rawMax, defaults) => {
  const defaultMin = Number.isFinite(defaults?.min)
    ? Math.max(1, Math.floor(defaults.min))
    : 1;
  const defaultMax = Number.isFinite(defaults?.max)
    ? Math.max(1, Math.floor(defaults.max))
    : defaultMin;
  const minRaw = Number.isFinite(rawMin) ? Math.max(1, Math.floor(rawMin)) : defaultMin;
  const maxRaw = Number.isFinite(rawMax) ? Math.max(1, Math.floor(rawMax)) : defaultMax;
  return {
    min: Math.min(minRaw, maxRaw),
    max: Math.max(minRaw, maxRaw)
  };
};

export const normalizeChargramFields = (entries) => {
  if (!Array.isArray(entries) || !entries.length) return DEFAULT_CHARGRAM_FIELDS;
  const deduped = new Set();
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim().toLowerCase();
    if (!normalized || !ALLOWED_CHARGRAM_FIELDS.has(normalized)) continue;
    deduped.add(normalized);
  }
  if (!deduped.size) return DEFAULT_CHARGRAM_FIELDS;
  return [...deduped];
};

export const resolveFieldTokenSampleSize = (tokenRetention, fallback = 32) => (
  Number.isFinite(Number(tokenRetention?.sampleSize))
    ? Math.max(1, Math.floor(Number(tokenRetention.sampleSize)))
    : Math.max(1, Math.floor(Number(fallback) || 32))
);

export const accumulateFrequency = (freqMap, tokens) => {
  if (!freqMap || !Array.isArray(tokens) || !tokens.length) return;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    freqMap.set(token, (freqMap.get(token) || 0) + 1);
  }
};

export const appendFrequencyToPostingsMap = (postingsMap, freqMap, docId) => {
  if (!postingsMap || !freqMap || typeof freqMap.entries !== 'function') return;
  for (const [token, count] of freqMap.entries()) {
    let postings = postingsMap.get(token);
    if (!postings) {
      postings = [];
      postingsMap.set(token, postings);
    }
    postings.push([docId, count]);
  }
};
