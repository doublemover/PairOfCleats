/**
 * Normalize postings configuration for phrase n-grams and chargrams.
 * @param {object} [input]
 * @returns {{
 *   enablePhraseNgrams:boolean,
 *   enableChargrams:boolean,
 *   phraseMinN:number,
 *   phraseMaxN:number,
 *   chargramMinN:number,
 *   chargramMaxN:number
 * }}
 */
export function normalizePostingsConfig(input = {}) {
  const cfg = input && typeof input === 'object' ? input : {};
  const enablePhraseNgrams = cfg.enablePhraseNgrams !== false;
  const enableChargrams = cfg.enableChargrams !== false;

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

  return {
    enablePhraseNgrams,
    enableChargrams,
    phraseMinN: phraseRange.min,
    phraseMaxN: phraseRange.max,
    chargramMinN: chargramRange.min,
    chargramMaxN: chargramRange.max
  };
}
