import { DEFAULT_EMBEDDING_TRUNCATION } from '../embedding-utils.js';

const invalid = message => Object.assign(new Error(message), { code: 'ERR_ONNX_TOKENIZER_OUTPUT' });
const tokenizers = new WeakMap();
let nextTokenizerId = 0;
const isRow = value => Array.isArray(value) || ArrayBuffer.isView(value) && typeof value.length === 'number';
const normalizeTokenValue = (value, field = 'input_ids') => {
  const parsed = typeof value === 'bigint' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) throw invalid(`${field} contains an invalid token integer.`);
  return parsed;
};
const normalizeMaskValue = value => {
  if (value === true || value === 1 || value === 1n) return 1;
  if (value === false || value === 0 || value === 0n) return 0;
  throw invalid('attention_mask contains a value other than zero or one.');
};
const normalizeFieldRows = (value, rowCount, field) => {
  if (!isRow(value)) throw invalid(`${field} is not an array of token rows.`);
  const nested = Array.isArray(value) && value.length > 0 && isRow(value[0]);
  if (nested ? value.length !== rowCount : rowCount !== 1) throw invalid(`${field} row count differs from the requested texts.`);
  const source = nested ? value : [value];
  return source.map(row => {
    if (!isRow(row)) throw invalid(`${field} contains a missing or malformed row.`);
    return Array.from(row, entry => field === 'attention_mask' ? normalizeMaskValue(entry) : normalizeTokenValue(entry, field));
  });
};

// These keys identify only pure token data, never model/session ownership. Each
// adapter retains the exact tokenizer object and preprocessing policy it uses.
export const createTokenizationIdentity = ({ tokenizer, wantsTokenTypeIds = false,
  truncation = DEFAULT_EMBEDDING_TRUNCATION, maxLength = null }) => {
  if (typeof tokenizer !== 'function') throw invalid('Tokenizer is not callable.');
  if (typeof truncation !== 'boolean' && typeof truncation !== 'string') throw invalid('Tokenizer truncation policy is unsupported.');
  if (maxLength != null && (!Number.isSafeInteger(maxLength) || maxLength <= 0)) throw invalid('Tokenizer maximum length is invalid.');
  if (!tokenizers.has(tokenizer)) tokenizers.set(tokenizer, ++nextTokenizerId);
  return JSON.stringify([tokenizers.get(tokenizer), wantsTokenTypeIds === true, truncation, maxLength]);
};

const count = (measurements, field, amount) => {
  if (measurements) measurements[field] = Math.min(Number.MAX_SAFE_INTEGER, (measurements[field] || 0) + amount);
};

const buildRowsFromTokenizerOutput = (encoded, rowCount, { wantsTokenTypeIds = false } = {}) => {
  const inputRows = normalizeFieldRows(encoded?.input_ids, rowCount, 'input_ids');
  const maskRows = encoded?.attention_mask == null ? null : normalizeFieldRows(encoded.attention_mask, rowCount, 'attention_mask');
  const tokenTypeRows = wantsTokenTypeIds && encoded?.token_type_ids != null
    ? normalizeFieldRows(encoded.token_type_ids, rowCount, 'token_type_ids')
    : null;
  const rows = new Array(rowCount);
  for (let i = 0; i < rowCount; i += 1) {
    const inputIds = inputRows[i] || [];
    const width = inputIds.length;
    if (maskRows && maskRows[i].length !== width || tokenTypeRows && tokenTypeRows[i].length !== width) {
      throw invalid('Tokenizer mask or token-type width differs from its input token row.');
    }
    const mask = maskRows ? maskRows[i] : Array(width).fill(1);
    const tokenTypeIds = wantsTokenTypeIds
      ? tokenTypeRows ? tokenTypeRows[i] : Array(width).fill(0)
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

const buildTokenizationCacheKey = (text, identity) => JSON.stringify([identity, text]);

export const buildPaddedBatchEncoding = (rows, { wantsTokenTypeIds = false, padTokenId = 0, measurements = null } = {}) => {
  padTokenId = normalizeTokenValue(padTokenId, 'pad_token_id');
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
      idRow[c] = hasToken ? normalizeTokenValue(ids[c]) : padTokenId;
      maskRow[c] = hasToken ? normalizeMaskValue(maskSrc[c] ?? 1) : 0;
      if (tokenTypeRow) {
        tokenTypeRow[c] = hasToken ? normalizeTokenValue(tokenTypeSrc[c] ?? 0, 'token_type_ids') : 0;
      }
    }
    input_ids[r] = idRow;
    attention_mask[r] = maskRow;
    if (tokenTypeRow) token_type_ids[r] = tokenTypeRow;
  }
  count(measurements, 'paddedTokenCells', rows.length * width);
  count(measurements, 'paddedFieldCells', rows.length * width * (wantsTokenTypeIds ? 3 : 2));
  return {
    input_ids,
    attention_mask,
    token_type_ids
  };
};

export const prepareTokenRowsWithCache = ({
  tokenizer,
  texts,
  wantsTokenTypeIds = false,
  truncation = DEFAULT_EMBEDDING_TRUNCATION,
  maxLength = null,
  tokenizationCache = null,
  preparedRows = null,
  measurements = null
}) => {
  const list = Array.isArray(texts) ? texts.map((text) => (typeof text === 'string' ? text : String(text ?? ''))) : [];
  if (!list.length) {
    return [];
  }
  const identity = createTokenizationIdentity({ tokenizer, wantsTokenTypeIds, truncation, maxLength });
  const rows = new Array(list.length);
  const missingByText = new Map();
  const cacheEnabled = tokenizationCache?.enabled === true;
  const cache = cacheEnabled ? tokenizationCache.cache : null;
  const maxEntries = cacheEnabled
    ? Math.max(1, Number(tokenizationCache.maxEntries) || 256)
    : 0;
  for (let i = 0; i < list.length; i += 1) {
    const text = list[i];
    const prepared = preparedRows?.take(text, identity);
    if (prepared) { rows[i] = prepared; count(measurements, 'preparedTokenRowHits', 1); continue; }
    if (cacheEnabled) {
      const key = buildTokenizationCacheKey(text, identity);
      const cached = getTokenCacheValue(cache, key);
      if (cached) {
        rows[i] = cached;
        count(measurements, 'tokenCacheRowHits', 1);
        continue;
      }
    }
    const current = missingByText.get(text);
    if (current) current.push(i);
    else missingByText.set(text, [i]);
  }
  if (missingByText.size) {
    const missingTexts = Array.from(missingByText.keys());
    count(measurements, 'tokenizerCalls', 1);
    count(measurements, 'tokenizerInputTexts', missingTexts.length);
    const encodedMissing = tokenizer(missingTexts, {
      padding: false,
      truncation,
      ...(maxLength ? { max_length: maxLength } : {}),
      return_tensor: false,
      return_token_type_ids: wantsTokenTypeIds
    });
    const missingRows = buildRowsFromTokenizerOutput(encodedMissing, missingTexts.length, {
      wantsTokenTypeIds
    });
    for (let i = 0; i < missingTexts.length; i += 1) {
      const text = missingTexts[i];
      const row = missingRows[i];
      if (cacheEnabled) {
        const key = buildTokenizationCacheKey(text, identity);
        setTokenCacheValue(cache, key, row, maxEntries);
      }
      const indexes = missingByText.get(text) || [];
      for (const index of indexes) {
        rows[index] = row;
      }
    }
  }
  count(measurements, 'preparedTokenRows', rows.length);
  count(measurements, 'preparedUsefulTokens', rows.reduce((sum, row) => sum + row.attention_mask.reduce((tokens, value) => tokens + value, 0), 0));
  return rows;
};

// Adapter-local, bounded ownership between planning and dispatch. A lease is
// released by the admitted request even on failure; expiry also bounds callers
// that estimate without subsequently dispatching.
export const createPreparedTokenRows = ({ maxEntries = 4096, maxBytes = 16 * 1024 * 1024, ttlMs = 60000 } = {}) => {
  const entries = new Map();
  let bytes = 0, timer = null;
  const remove = key => {
    const entry = entries.get(key);
    if (entry) { entries.delete(key); bytes -= entry.bytes; }
    if (!entries.size && timer) { clearTimeout(timer); timer = null; }
  };
  const expire = () => {
    timer = null;
    const now = Date.now();
    for (const [key, entry] of entries) if (entry.expiresAt <= now) remove(key);
    if (entries.size) { timer = setTimeout(expire, ttlMs); timer.unref?.(); }
  };
  return {
    retain(texts, rows, identity) {
      const owner = {}, keys = [];
      for (let i = 0; i < texts.length; i++) {
        const key = buildTokenizationCacheKey(texts[i], identity), row = rows[i];
        const size = key.length * 2 + 128 + (row.input_ids.length + row.attention_mask.length + (row.token_type_ids?.length || 0)) * 8;
        if (size > maxBytes) continue;
        remove(key);
        while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value);
        entries.set(key, { owner, row, bytes: size, expiresAt: Date.now() + ttlMs }); bytes += size; keys.push(key);
      }
      if (entries.size && !timer) { timer = setTimeout(expire, ttlMs); timer.unref?.(); }
      return () => { for (const key of keys) if (entries.get(key)?.owner === owner) remove(key); };
    },
    take(text, identity) {
      const key = buildTokenizationCacheKey(text, identity), entry = entries.get(key);
      if (!entry) return null;
      remove(key);
      return entry.expiresAt > Date.now() ? entry.row : null;
    },
    clear() { for (const key of entries.keys()) remove(key); },
    stats: () => ({ entries: entries.size, bytes, maxEntries, maxBytes })
  };
};

export const tokenizeBatchWithCache = input => buildPaddedBatchEncoding(prepareTokenRowsWithCache(input), {
  wantsTokenTypeIds: input.wantsTokenTypeIds,
  padTokenId: input.tokenizer?.pad_token_id ?? 0,
  measurements: input.measurements
});

export const __tokenizeBatchWithCacheForTests = (input = {}) => tokenizeBatchWithCache(input);
