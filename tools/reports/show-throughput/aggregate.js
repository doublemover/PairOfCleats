export const MODE_METRICS = [
  ['code', 'Code'],
  ['prose', 'Prose'],
  ['extracted-prose', 'Extracted Prose'],
  ['records', 'Records']
];

const LANGUAGE_KEY_ALIASES = new Map([
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['ts', 'typescript'],
  ['py', 'python'],
  ['rb', 'ruby'],
  ['sh', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['yml', 'yaml'],
  ['md', 'markdown'],
  ['htm', 'html'],
  ['cs', 'csharp'],
  ['kt', 'kotlin'],
  ['hbs', 'handlebars'],
  ['jinja2', 'jinja'],
  ['cshtml', 'razor'],
  ['hs', 'haskell']
]);

export const THROUGHPUT_GROUPS = [
  { label: 'Code throughput', pick: (throughput) => throughput?.code || null },
  { label: 'Prose throughput', pick: (throughput) => throughput?.prose || null },
  { label: 'Extracted prose throughput', pick: (throughput) => throughput?.extractedProse || null },
  { label: 'Records throughput', pick: (throughput) => throughput?.records || null },
  { label: 'LMDB code throughput', pick: (throughput) => throughput?.lmdb?.code || null },
  { label: 'LMDB prose throughput', pick: (throughput) => throughput?.lmdb?.prose || null }
];

export const THROUGHPUT_TOTAL_LABEL_WIDTH = 10;
export const MODE_THROUGHPUT_TOTALS = [
  { label: 'Code', pick: (totals) => totals?.code || null, modeKey: 'code' },
  { label: 'Prose', pick: (totals) => totals?.prose || null, modeKey: 'prose' },
  { label: 'XProse', pick: (totals) => totals?.extractedProse || null, modeKey: 'extracted-prose' },
  { label: 'Records', pick: (totals) => totals?.records || null, modeKey: 'records' }
];

export const MODE_SHORT_LABEL = {
  code: 'Code',
  prose: 'Prose',
  'extracted-prose': 'XProse',
  records: 'Records'
};

export const INDEXING_SCHEMA_VERSION = 1;

const THROUGHPUT_KEY_BY_MODE = {
  code: 'code',
  prose: 'prose',
  'extracted-prose': 'extractedProse',
  records: 'records'
};

export const toFiniteOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const createRateTotals = () => ({ files: 0, chunks: 0, tokens: 0, bytes: 0, totalMs: 0 });
export const createModeTotals = () => ({ repos: 0, files: 0, lines: 0, bytes: 0, durationMs: 0 });

export const mergeTotals = (target, entry) => {
  if (!entry) return;
  if (Number.isFinite(entry.files)) target.files += entry.files;
  if (Number.isFinite(entry.chunks)) target.chunks += entry.chunks;
  if (Number.isFinite(entry.tokens)) target.tokens += entry.tokens;
  if (Number.isFinite(entry.bytes)) target.bytes += entry.bytes;
  if (Number.isFinite(entry.totalMs)) target.totalMs += entry.totalMs;
};

export const createModeTotalsMap = () => new Map(
  MODE_METRICS.map(([key]) => [key, createModeTotals()])
);

export const hasModeTotals = (totals) => (
  Number.isFinite(totals?.lines) && totals.lines > 0
) || (
  Number.isFinite(totals?.files) && totals.files > 0
);

export const rateFromTotals = (totals, key) => {
  if (!Number.isFinite(totals.totalMs) || totals.totalMs <= 0) return null;
  const value = totals[key];
  if (!Number.isFinite(value)) return null;
  return value / (totals.totalMs / 1000);
};

export const sumRates = (...values) => {
  let sum = 0;
  let found = false;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    found = true;
  }
  return found ? sum : null;
};

export const mean = (values) => {
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
};

export const collect = (items, selector) => items
  .map((item) => selector(item))
  .filter((value) => Number.isFinite(value));

export const meanThroughput = (throughputs, pick) => {
  const entries = throughputs.map((item) => pick(item)).filter(Boolean);
  if (!entries.length) return null;
  return {
    chunksPerSec: mean(collect(entries, (entry) => entry.chunksPerSec)),
    tokensPerSec: mean(collect(entries, (entry) => entry.tokensPerSec)),
    bytesPerSec: mean(collect(entries, (entry) => entry.bytesPerSec)),
    filesPerSec: mean(collect(entries, (entry) => entry.filesPerSec))
  };
};

export const mergeModeTotalsFromFeatureMetrics = (metrics, totalsMap) => {
  if (!metrics || !metrics.modes || !totalsMap) return;
  for (const [modeKey] of MODE_METRICS) {
    const totals = metrics?.modes?.[modeKey]?.totals;
    if (!totals) continue;
    const lines = toFiniteOrNull(totals.lines);
    const files = toFiniteOrNull(totals.count);
    const bytes = toFiniteOrNull(totals.bytes);
    const durationMs = toFiniteOrNull(totals.durationMs);
    if (!Number.isFinite(lines) && !Number.isFinite(files) && !Number.isFinite(bytes) && !Number.isFinite(durationMs)) {
      continue;
    }
    const bucket = totalsMap.get(modeKey);
    if (!bucket) continue;
    bucket.repos += 1;
    if (Number.isFinite(files)) bucket.files += files;
    if (Number.isFinite(lines)) bucket.lines += lines;
    if (Number.isFinite(bytes)) bucket.bytes += bytes;
    if (Number.isFinite(durationMs) && Number.isFinite(lines) && lines > 0) bucket.durationMs += durationMs;
  }
};

const extractPandocFenceLanguage = (value) => {
  const match = String(value || '').match(/^\{([^}]*)\}$/);
  if (!match) return null;
  const body = String(match[1] || '').trim();
  if (!body) return null;
  const tokens = body.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const normalized = String(token || '').trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.startsWith('.')) {
      const className = normalized.slice(1);
      if (className) return className;
    }
    if (normalized.startsWith('class=')) {
      const className = normalized.slice('class='.length).replace(/^['"]|['"]$/g, '');
      if (className) return className.replace(/^\./, '');
    }
  }
  return null;
};

const normalizeMetricsLanguageKey = (rawLanguage) => {
  let normalized = String(rawLanguage || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  const pandocFenceLanguage = extractPandocFenceLanguage(normalized);
  if (pandocFenceLanguage) normalized = pandocFenceLanguage;
  normalized = normalized
    .replace(/^`+|`+$/g, '')
    .replace(/^\./, '')
    .replace(/^\{+|\}+$/g, '')
    .trim();
  if (!normalized) return 'unknown';
  if (normalized === 'unknown' || normalized === 'n/a' || normalized === 'none' || normalized === 'null') {
    return 'unknown';
  }
  const alias = LANGUAGE_KEY_ALIASES.get(normalized);
  return alias || normalized;
};

export const collectLanguageLines = (metrics, totals) => {
  if (!metrics || !metrics.modes) return;
  for (const modeEntry of Object.values(metrics.modes)) {
    const languages = modeEntry?.languages || {};
    for (const [language, bucket] of Object.entries(languages)) {
      const lines = Number(bucket?.lines) || 0;
      if (!lines) continue;
      const normalizedLanguage = normalizeMetricsLanguageKey(language);
      totals.set(normalizedLanguage, (totals.get(normalizedLanguage) || 0) + lines);
    }
  }
};

const buildModeIndexingSummary = (totals) => {
  const files = toFiniteOrNull(totals?.count);
  const lines = toFiniteOrNull(totals?.lines);
  const bytes = toFiniteOrNull(totals?.bytes);
  const durationMs = toFiniteOrNull(totals?.durationMs);
  const linesPerSec = (Number.isFinite(lines) && Number.isFinite(durationMs) && durationMs > 0)
    ? (lines / (durationMs / 1000))
    : null;
  return {
    files,
    lines,
    bytes,
    durationMs,
    linesPerSec
  };
};

export const buildIndexingSummaryFromFeatureMetrics = (metrics) => {
  if (!metrics || typeof metrics !== 'object') return null;
  const modes = {};
  const totals = { files: 0, lines: 0, bytes: 0, durationMs: 0 };
  const languageLines = {};
  let hasData = false;

  for (const [modeKey] of MODE_METRICS) {
    const modeEntry = metrics?.modes?.[modeKey];
    const modeTotals = buildModeIndexingSummary(modeEntry?.totals || null);
    modes[modeKey] = modeTotals;
    if (Number.isFinite(modeTotals.files)) totals.files += modeTotals.files;
    if (Number.isFinite(modeTotals.lines)) totals.lines += modeTotals.lines;
    if (Number.isFinite(modeTotals.bytes)) totals.bytes += modeTotals.bytes;
    if (Number.isFinite(modeTotals.durationMs)) totals.durationMs += modeTotals.durationMs;
    if (hasModeTotals(modeTotals)) hasData = true;
    const languages = modeEntry?.languages || {};
    for (const [language, bucket] of Object.entries(languages)) {
      const lines = Number(bucket?.lines);
      if (!Number.isFinite(lines) || lines <= 0) continue;
      const normalizedLanguage = normalizeMetricsLanguageKey(language);
      languageLines[normalizedLanguage] = (languageLines[normalizedLanguage] || 0) + lines;
    }
  }

  if (!hasData) return null;
  const totalLinesPerSec = totals.durationMs > 0 ? (totals.lines / (totals.durationMs / 1000)) : null;
  return {
    schemaVersion: INDEXING_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'feature-metrics',
    modes,
    totals: {
      ...totals,
      linesPerSec: totalLinesPerSec
    },
    languageLines
  };
};

export const buildIndexingSummaryFromThroughput = (throughput) => {
  if (!throughput || typeof throughput !== 'object') return null;
  const modes = {};
  const totals = { files: 0, lines: 0, bytes: 0, durationMs: 0 };
  let hasData = false;
  for (const [modeKey] of MODE_METRICS) {
    const throughputKey = THROUGHPUT_KEY_BY_MODE[modeKey];
    const entry = throughput?.[throughputKey];
    const files = toFiniteOrNull(entry?.files);
    const bytes = toFiniteOrNull(entry?.bytes);
    const durationMs = toFiniteOrNull(entry?.totalMs);
    const modeTotals = {
      files,
      lines: null,
      bytes,
      durationMs,
      linesPerSec: null
    };
    modes[modeKey] = modeTotals;
    if (Number.isFinite(files)) totals.files += files;
    if (Number.isFinite(bytes)) totals.bytes += bytes;
    if (Number.isFinite(durationMs)) totals.durationMs += durationMs;
    if (hasModeTotals(modeTotals)) hasData = true;
  }
  if (!hasData) return null;
  return {
    schemaVersion: INDEXING_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'throughput',
    modes,
    totals: {
      ...totals,
      linesPerSec: null
    },
    languageLines: {}
  };
};

export const isValidIndexingSummary = (indexingSummary) => {
  if (!indexingSummary || typeof indexingSummary !== 'object') return false;
  if (indexingSummary.schemaVersion !== INDEXING_SCHEMA_VERSION) return false;
  return MODE_METRICS.some(([modeKey]) => hasModeTotals(indexingSummary?.modes?.[modeKey]));
};

export const mergeModeTotalsFromIndexingSummary = (indexingSummary, totalsMap) => {
  if (!isValidIndexingSummary(indexingSummary) || !totalsMap) return;
  for (const [modeKey] of MODE_METRICS) {
    const totals = indexingSummary?.modes?.[modeKey];
    if (!totals) continue;
    const lines = toFiniteOrNull(totals.lines);
    const files = toFiniteOrNull(totals.files);
    const bytes = toFiniteOrNull(totals.bytes);
    const durationMs = toFiniteOrNull(totals.durationMs);
    if (!Number.isFinite(lines) && !Number.isFinite(files) && !Number.isFinite(bytes) && !Number.isFinite(durationMs)) {
      continue;
    }
    const bucket = totalsMap.get(modeKey);
    if (!bucket) continue;
    bucket.repos += 1;
    if (Number.isFinite(files)) bucket.files += files;
    if (Number.isFinite(lines)) bucket.lines += lines;
    if (Number.isFinite(bytes)) bucket.bytes += bytes;
    if (Number.isFinite(durationMs) && Number.isFinite(lines) && lines > 0) bucket.durationMs += durationMs;
  }
};

export const collectLanguageLinesFromSummary = (indexingSummary, totals) => {
  if (!isValidIndexingSummary(indexingSummary) || !totals) return;
  const languageLines = indexingSummary?.languageLines || {};
  for (const [language, linesValue] of Object.entries(languageLines)) {
    const lines = Number(linesValue);
    if (!Number.isFinite(lines) || lines <= 0) continue;
    const normalizedLanguage = normalizeMetricsLanguageKey(language);
    totals.set(normalizedLanguage, (totals.get(normalizedLanguage) || 0) + lines);
  }
};
