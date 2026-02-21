import util from 'node:util';

export const summarizeError = (err, options = {}) => {
  const {
    maxLen = 240,
    fullDepth = false
  } = options;
  if (!err) return '';
  const asString = (value) => (typeof value === 'string' ? value.trim() : '');
  let detail = asString(err?.message)
    || asString(err?.code)
    || asString(err?.name)
    || asString(typeof err === 'string' ? err : '');
  if (!detail || detail === '[object Object]' || detail === '{}') {
    detail = util.inspect(err, {
      depth: fullDepth ? null : 2,
      breakLength: 120,
      maxArrayLength: fullDepth ? null : 6,
      maxStringLength: fullDepth ? null : 200,
      showHidden: true,
      getters: true
    });
    if (detail === '{}' || detail === '[object Object]') {
      try {
        detail = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
      } catch (jsonErr) {
        detail = detail || `unserializable error: ${asString(jsonErr?.message)}`;
      }
    }
  }
  detail = detail.replace(/\s+/g, ' ').trim();
  if (maxLen > 3 && detail.length > maxLen) {
    detail = `${detail.slice(0, maxLen - 3)}...`;
  }
  return detail;
};

export const sanitizePoolPayload = (payload, dictConfig) => {
  if (!payload || typeof payload !== 'object') return payload;
  const safe = {
    text: typeof payload.text === 'string' ? payload.text : '',
    mode: typeof payload.mode === 'string' ? payload.mode : 'code',
    ext: typeof payload.ext === 'string' ? payload.ext : '',
    languageId: typeof payload.languageId === 'string' ? payload.languageId : ''
  };
  if (Array.isArray(payload.chargramTokens)) {
    safe.chargramTokens = payload.chargramTokens.filter((token) => typeof token === 'string');
  }
  if (dictConfig && typeof dictConfig === 'object') {
    safe.dictConfig = dictConfig;
  }
  return safe;
};

export const sanitizeQuantizePayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return { vectors: [] };
  }
  const safe = {
    vectors: Array.isArray(payload.vectors) ? payload.vectors : []
  };
  const minVal = Number(payload.minVal);
  if (Number.isFinite(minVal)) safe.minVal = minVal;
  const maxVal = Number(payload.maxVal);
  if (Number.isFinite(maxVal)) safe.maxVal = maxVal;
  const levels = Number(payload.levels);
  if (Number.isFinite(levels)) safe.levels = levels;
  return safe;
};
