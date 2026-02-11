/**
 * Normalize postings configuration for phrase n-grams and chargrams.
 * @param {object} [input]
 * @returns {{
 *   enablePhraseNgrams:boolean,
 *   enableChargrams:boolean,
 *   phraseMinN:number,
 *   phraseMaxN:number,
 *   chargramMinN:number,
 *   chargramMaxN:number,
 *   chargramMaxTokenLength:number|null,
 *   chargramSpillMaxUnique:number,
 *   chargramMaxDf:number,
 *   chargramSource:string,
 *   phraseSource:string,
 *   typed:boolean,
 *   fielded:boolean,
 *   tokenClassification:{enabled:boolean}
 * }}
 */
export function normalizePostingsConfig(input = {}) {
  const MAX_CHARGRAM_N = 8;
  const MAX_CHARGRAM_TOKEN_LENGTH = 128;
  const cfg = input && typeof input === 'object' ? input : {};
  const enablePhraseNgrams = cfg.enablePhraseNgrams !== false;
  const enableChargrams = cfg.enableChargrams !== false;
  const fielded = cfg.fielded !== false;
  const tokenClassificationRaw = cfg.tokenClassification;
  const tokenClassificationEnabled = typeof tokenClassificationRaw === 'boolean'
    ? tokenClassificationRaw
    : (tokenClassificationRaw && typeof tokenClassificationRaw === 'object'
      ? tokenClassificationRaw.enabled !== false
      : true);

  // Phrase n-grams are very high-cardinality when derived from the full token
  // stream of source code. Default to deriving them from low-cardinality fields
  // (name/signature/doc/comment) unless explicitly requested.
  const phraseSourceRaw = typeof cfg.phraseSource === 'string'
    ? cfg.phraseSource.trim().toLowerCase()
    : '';
  const phraseSource = ['full', 'fields'].includes(phraseSourceRaw)
    ? phraseSourceRaw
    : 'fields';
  const chargramSourceRaw = typeof cfg.chargramSource === 'string'
    ? cfg.chargramSource.trim().toLowerCase()
    : '';
  const chargramSource = ['full', 'fields'].includes(chargramSourceRaw)
    ? chargramSourceRaw
    : 'fields';

  const toInt = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.floor(num);
  };
  const normalizeRange = (minRaw, maxRaw, defaults) => {
    let min = toInt(minRaw);
    let max = toInt(maxRaw);
    if (!Number.isFinite(min) || min <= 0) min = defaults.min;
    if (!Number.isFinite(max) || max <= 0) max = defaults.max;
    if (max < min) max = min;
    return { min, max };
  };

  const phraseRange = normalizeRange(cfg.phraseMinN, cfg.phraseMaxN, { min: 2, max: 4 });
  const chargramRange = normalizeRange(cfg.chargramMinN, cfg.chargramMaxN, { min: 3, max: 5 });
  if (chargramRange.min > MAX_CHARGRAM_N) chargramRange.min = MAX_CHARGRAM_N;
  if (chargramRange.max > MAX_CHARGRAM_N) chargramRange.max = MAX_CHARGRAM_N;
  if (chargramRange.max < chargramRange.min) chargramRange.max = chargramRange.min;
  let chargramMaxTokenLength = 48;
  if (cfg.chargramMaxTokenLength === 0 || cfg.chargramMaxTokenLength === false) {
    chargramMaxTokenLength = null;
  } else {
    const maxTokenRaw = Number(cfg.chargramMaxTokenLength);
    if (Number.isFinite(maxTokenRaw)) {
      chargramMaxTokenLength = Math.max(2, Math.floor(maxTokenRaw));
    }
    if (Number.isFinite(chargramMaxTokenLength)) {
      chargramMaxTokenLength = Math.min(chargramMaxTokenLength, MAX_CHARGRAM_TOKEN_LENGTH);
    }
  }
  const chargramSpillRaw = Number(cfg.chargramSpillMaxUnique);
  const chargramSpillMaxUnique = Number.isFinite(chargramSpillRaw)
    ? Math.max(0, Math.floor(chargramSpillRaw))
    : 500000;
  const chargramMaxDfRaw = Number(cfg.chargramMaxDf);
  const chargramMaxDf = Number.isFinite(chargramMaxDfRaw)
    ? Math.max(0, Math.floor(chargramMaxDfRaw))
    : 0;
  const typed = cfg.typed === true;

  return {
    enablePhraseNgrams,
    enableChargrams,
    phraseMinN: phraseRange.min,
    phraseMaxN: phraseRange.max,
    phraseSource,
    chargramMinN: chargramRange.min,
    chargramMaxN: chargramRange.max,
    chargramMaxTokenLength,
    chargramSpillMaxUnique,
    chargramMaxDf,
    chargramSource,
    typed,
    fielded,
    tokenClassification: {
      enabled: tokenClassificationEnabled
    }
  };
}
