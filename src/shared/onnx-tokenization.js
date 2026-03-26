import { DEFAULT_EMBEDDING_TRUNCATION } from './embedding-utils.js';

const normalizeTokenValue = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
};

const normalizeFieldRows = (value, rowCount) => {
  if (rowCount <= 0) return [];
  const emptyRows = Array.from({ length: rowCount }, () => []);
  if (!Array.isArray(value) || !value.length) return emptyRows;
  const first = value[0];
  if (Array.isArray(first) || ArrayBuffer.isView(first)) {
    const rows = value.map((row) => Array.from(row || [], (entry) => normalizeTokenValue(entry, 0)));
    while (rows.length < rowCount) rows.push([]);
    return rows.slice(0, rowCount);
  }
  const row = Array.from(value, (entry) => normalizeTokenValue(entry, 0));
  return [row, ...Array.from({ length: rowCount - 1 }, () => [])];
};

const buildRowsFromTokenizerOutput = (encoded, rowCount, { wantsTokenTypeIds = false } = {}) => {
  const inputRows = normalizeFieldRows(encoded?.input_ids, rowCount);
  const maskRows = normalizeFieldRows(encoded?.attention_mask, rowCount);
  const tokenTypeRows = wantsTokenTypeIds
    ? normalizeFieldRows(encoded?.token_type_ids, rowCount)
    : null;
  const rows = new Array(rowCount);
  for (let i = 0; i < rowCount; i += 1) {
    const inputIds = inputRows[i] || [];
    const width = inputIds.length;
    const mask = new Array(width);
    const sourceMask = maskRows[i] || [];
    for (let c = 0; c < width; c += 1) {
      mask[c] = Number(sourceMask[c] ?? 1) ? 1 : 0;
    }
    const tokenTypeIds = wantsTokenTypeIds
      ? Array.from({ length: width }, (_, c) => normalizeTokenValue(tokenTypeRows?.[i]?.[c], 0))
      : null;
    rows[i] = {
      input_ids: inputIds,
      attention_mask: mask,
      token_type_ids: tokenTypeIds
    };
  }
  return rows;
};

const getTokenCacheValue = (cache, key) => {
  if (!cache || !cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const setTokenCacheValue = (cache, key, value, maxEntries) => {
  if (!cache) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
};

const buildTokenizationCacheKey = (text, wantsTokenTypeIds) => `${wantsTokenTypeIds ? 1 : 0}:${text}`;

const buildPaddedBatchEncoding = (rows, { wantsTokenTypeIds = false, padTokenId = 0 } = {}) => {
  const width = rows.reduce((max, row) => Math.max(max, row?.input_ids?.length || 0), 0);
  const input_ids = new Array(rows.length);
  const attention_mask = new Array(rows.length);
  const token_type_ids = wantsTokenTypeIds ? new Array(rows.length) : undefined;
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] || {};
    const ids = row.input_ids || [];
    const maskSrc = row.attention_mask || [];
    const tokenTypeSrc = row.token_type_ids || [];
    const idRow = new Array(width);
    const maskRow = new Array(width);
    const tokenTypeRow = wantsTokenTypeIds ? new Array(width) : null;
    for (let c = 0; c < width; c += 1) {
      const hasToken = c < ids.length;
      idRow[c] = hasToken ? normalizeTokenValue(ids[c], padTokenId) : padTokenId;
      maskRow[c] = hasToken ? (Number(maskSrc[c] ?? 1) ? 1 : 0) : 0;
      if (tokenTypeRow) {
        tokenTypeRow[c] = hasToken ? normalizeTokenValue(tokenTypeSrc[c], 0) : 0;
      }
    }
    input_ids[r] = idRow;
    attention_mask[r] = maskRow;
    if (tokenTypeRow) token_type_ids[r] = tokenTypeRow;
  }
  return {
    input_ids,
    attention_mask,
    token_type_ids
  };
};

export const tokenizeBatchWithCache = ({
  tokenizer,
  texts,
  wantsTokenTypeIds = false,
  truncation = DEFAULT_EMBEDDING_TRUNCATION,
  tokenizationCache = null
}) => {
  const list = Array.isArray(texts) ? texts.map((text) => (typeof text === 'string' ? text : String(text ?? ''))) : [];
  if (!list.length) {
    return {
      input_ids: [],
      attention_mask: [],
      token_type_ids: wantsTokenTypeIds ? [] : undefined
    };
  }
  const rows = new Array(list.length);
  const missingByText = new Map();
  const cacheEnabled = tokenizationCache?.enabled === true;
  const cache = cacheEnabled ? tokenizationCache.cache : null;
  const maxEntries = cacheEnabled
    ? Math.max(1, Number(tokenizationCache.maxEntries) || 256)
    : 0;
  for (let i = 0; i < list.length; i += 1) {
    const text = list[i];
    if (cacheEnabled) {
      const key = buildTokenizationCacheKey(text, wantsTokenTypeIds);
      const cached = getTokenCacheValue(cache, key);
      if (cached) {
        rows[i] = cached;
        continue;
      }
    }
    const current = missingByText.get(text);
    if (current) current.push(i);
    else missingByText.set(text, [i]);
  }
  if (missingByText.size) {
    const missingTexts = Array.from(missingByText.keys());
    const encodedMissing = tokenizer(missingTexts, {
      padding: false,
      truncation,
      return_tensor: false,
      return_token_type_ids: wantsTokenTypeIds
    });
    const missingRows = buildRowsFromTokenizerOutput(encodedMissing, missingTexts.length, {
      wantsTokenTypeIds
    });
    for (let i = 0; i < missingTexts.length; i += 1) {
      const text = missingTexts[i];
      const row = missingRows[i] || {
        input_ids: [],
        attention_mask: [],
        token_type_ids: wantsTokenTypeIds ? [] : null
      };
      if (cacheEnabled) {
        const key = buildTokenizationCacheKey(text, wantsTokenTypeIds);
        setTokenCacheValue(cache, key, row, maxEntries);
      }
      const indexes = missingByText.get(text) || [];
      for (const index of indexes) {
        rows[index] = row;
      }
    }
  }
  const padTokenId = normalizeTokenValue(tokenizer?.pad_token_id, 0);
  return buildPaddedBatchEncoding(rows, { wantsTokenTypeIds, padTokenId });
};

export const __tokenizeBatchWithCacheForTests = (input = {}) => tokenizeBatchWithCache(input);
