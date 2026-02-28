import { sanitizeImportSpecifier } from '../../shared/import-specifier.js';
import {
  createCommentAwareLineStripper,
  stripInlineCommentAware,
  stripTemplateCommentBlocks
} from './comment-aware.js';

export const MAX_REGEX_LINE = 8192;

export const shouldScanLine = (line, precheck) => {
  if (!line) return false;
  if (line.length > MAX_REGEX_LINE) return false;
  if (precheck && !precheck(line)) return false;
  return true;
};

export const lineHasAny = (line, tokens) => {
  for (const token of tokens) {
    if (line.includes(token)) return true;
  }
  return false;
};

export const lineHasAnyInsensitive = (line, tokens) => {
  const lower = line.toLowerCase();
  for (const token of tokens) {
    if (lower.includes(token)) return true;
  }
  return false;
};

export const isPseudoImportToken = (value) => !sanitizeImportSpecifier(value);

export const sanitizeCollectorImportToken = (value) => sanitizeImportSpecifier(value);

export const addCollectorImport = (imports, value, sanitizeOptions = undefined) => {
  if (!(imports instanceof Set)) return false;
  const token = sanitizeImportSpecifier(value, sanitizeOptions);
  if (!token) return false;
  imports.add(token);
  return true;
};

export const applyCollectorSourceBudget = (
  text,
  { maxChars = 524288 } = {}
) => {
  const source = String(text || '');
  const normalizedMax = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (!normalizedMax) {
    return {
      source: '',
      truncated: source.length > 0
    };
  }
  if (source.length <= normalizedMax) {
    return {
      source,
      truncated: false
    };
  }
  return {
    source: source.slice(0, normalizedMax),
    truncated: true
  };
};

export const createCollectorScanBudget = ({
  maxMatches = 512,
  maxTokens = 512,
  maxMs = 0,
  timeSource = Date.now
} = {}) => {
  const normalizeCap = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
  };
  const limits = {
    maxMatches: normalizeCap(maxMatches),
    maxTokens: normalizeCap(maxTokens),
    maxMs: normalizeCap(maxMs)
  };
  const now = typeof timeSource === 'function' ? timeSource : Date.now;
  const startedAt = Number(now());
  let matches = 0;
  let tokens = 0;
  let timedOut = false;
  const refreshTimeout = () => {
    if (timedOut || limits.maxMs <= 0) return !timedOut;
    const current = Number(now());
    if (!Number.isFinite(current)) return true;
    if (current - startedAt < limits.maxMs) return true;
    timedOut = true;
    return false;
  };
  const matchesExhausted = () => limits.maxMatches > 0 && matches >= limits.maxMatches;
  const tokensExhausted = () => limits.maxTokens > 0 && tokens >= limits.maxTokens;
  return {
    limits,
    get matchesUsed() {
      return matches;
    },
    get tokensUsed() {
      return tokens;
    },
    get elapsedMs() {
      const current = Number(now());
      if (!Number.isFinite(current) || !Number.isFinite(startedAt)) return 0;
      return Math.max(0, current - startedAt);
    },
    get timedOut() {
      refreshTimeout();
      return timedOut;
    },
    get matchesExhausted() {
      return matchesExhausted();
    },
    get tokensExhausted() {
      return tokensExhausted();
    },
    get exhausted() {
      refreshTimeout();
      return (
        timedOut
        || matchesExhausted()
        || tokensExhausted()
      );
    },
    consumeTime() {
      return refreshTimeout();
    },
    consumeMatch() {
      if (!refreshTimeout()) return false;
      if (limits.maxMatches === 0) return true;
      if (matches >= limits.maxMatches) return false;
      matches += 1;
      return refreshTimeout();
    },
    consumeToken() {
      if (!refreshTimeout()) return false;
      if (limits.maxTokens === 0) return true;
      if (tokens >= limits.maxTokens) return false;
      tokens += 1;
      return refreshTimeout();
    }
  };
};

const normalizeCollectorBudgetValue = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.max(0, Math.floor(numeric));
};

const readCollectorBudgetOverrides = (options, collectorId) => {
  if (!options || typeof options !== 'object') return {};
  const global = options.collectorScanBudget;
  const perCollector = options.collectorScanBudgets;
  const byId = perCollector
    && typeof perCollector === 'object'
    && !Array.isArray(perCollector)
    && collectorId
    && perCollector[collectorId]
    && typeof perCollector[collectorId] === 'object'
    ? perCollector[collectorId]
    : null;
  return {
    ...(global && typeof global === 'object' && !Array.isArray(global) ? global : {}),
    ...(byId || {})
  };
};

export const resolveCollectorBudgetConfig = ({
  options = null,
  collectorId = '',
  defaults = {}
} = {}) => {
  const overrides = readCollectorBudgetOverrides(options, collectorId);
  return {
    maxChars: normalizeCollectorBudgetValue(overrides.maxChars, defaults.maxChars),
    maxMatches: normalizeCollectorBudgetValue(overrides.maxMatches, defaults.maxMatches),
    maxTokens: normalizeCollectorBudgetValue(overrides.maxTokens, defaults.maxTokens),
    maxMs: normalizeCollectorBudgetValue(overrides.maxMs, defaults.maxMs)
  };
};

const emitCollectorBudgetDiagnostic = (options, diagnostic) => {
  if (!diagnostic || typeof diagnostic !== 'object') return;
  if (Array.isArray(options?.collectorDiagnostics)) {
    options.collectorDiagnostics.push(diagnostic);
  }
  if (typeof options?.onCollectorDiagnostic === 'function') {
    try {
      options.onCollectorDiagnostic(diagnostic);
    } catch {}
  }
};

export const createCollectorBudgetContext = ({
  text,
  options = null,
  collectorId = '',
  defaults = {}
} = {}) => {
  const budget = resolveCollectorBudgetConfig({ options, collectorId, defaults });
  const source = String(text || '');
  const sourceBudget = applyCollectorSourceBudget(source, { maxChars: budget.maxChars });
  const scanBudget = createCollectorScanBudget({
    maxMatches: budget.maxMatches,
    maxTokens: budget.maxTokens,
    maxMs: budget.maxMs,
    timeSource: typeof options?.collectorNow === 'function' ? options.collectorNow : Date.now
  });
  let finalized = false;
  return {
    source: sourceBudget.source,
    sourceLength: source.length,
    sourceBudget,
    scanBudget,
    budget,
    finalize() {
      if (finalized) return;
      finalized = true;
      const reasons = [];
      if (sourceBudget.truncated) reasons.push('source_bytes');
      if (scanBudget.matchesExhausted) reasons.push('scan_matches');
      if (scanBudget.tokensExhausted) reasons.push('scan_tokens');
      if (scanBudget.timedOut) reasons.push('scan_time');
      if (!reasons.length) return;
      emitCollectorBudgetDiagnostic(options, {
        type: 'collector-scan-budget',
        collectorId,
        reasons,
        sourceLength: source.length,
        sourceScannedLength: sourceBudget.source.length,
        maxChars: budget.maxChars,
        maxMatches: budget.maxMatches,
        maxTokens: budget.maxTokens,
        maxMs: budget.maxMs,
        elapsedMs: scanBudget.elapsedMs,
        matchesUsed: scanBudget.matchesUsed,
        tokensUsed: scanBudget.tokensUsed
      });
    }
  };
};

const clampUnit = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
};

export const normalizeCollectorHint = (collectorHint) => {
  if (!collectorHint || typeof collectorHint !== 'object' || Array.isArray(collectorHint)) return null;
  const reasonCode = typeof collectorHint.reasonCode === 'string'
    ? collectorHint.reasonCode.trim()
    : '';
  if (!reasonCode) return null;
  const confidence = clampUnit(collectorHint.confidence);
  const detail = typeof collectorHint.detail === 'string' && collectorHint.detail.trim()
    ? collectorHint.detail.trim()
    : null;
  return {
    reasonCode,
    confidence,
    detail
  };
};

const readCollectorImportSpecifier = (value) => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  if (typeof value.specifier === 'string') return value.specifier;
  if (typeof value.import === 'string') return value.import;
  return '';
};

export const createCollectorImportEntryStore = () => new Map();

export const addCollectorImportEntry = (
  store,
  value,
  { collectorHint = null, sanitizeOptions = undefined } = {}
) => {
  if (!(store instanceof Map)) return false;
  const rawSpecifier = readCollectorImportSpecifier(value);
  const specifier = sanitizeImportSpecifier(rawSpecifier, sanitizeOptions);
  if (!specifier) return false;
  const normalizedHint = normalizeCollectorHint(
    collectorHint || (value && typeof value === 'object' ? value.collectorHint : null)
  );
  const existing = store.get(specifier);
  if (!existing) {
    store.set(specifier, {
      specifier,
      collectorHint: normalizedHint
    });
    return true;
  }
  if (!normalizedHint) return true;
  const existingConfidence = Number(existing?.collectorHint?.confidence);
  const nextConfidence = Number(normalizedHint?.confidence);
  const replaceHint = (
    !existing?.collectorHint
    || (
      Number.isFinite(nextConfidence)
      && (!Number.isFinite(existingConfidence) || nextConfidence > existingConfidence)
    )
  );
  if (replaceHint) existing.collectorHint = normalizedHint;
  return true;
};

export const collectorImportEntriesToSpecifiers = (entries) => (
  Array.isArray(entries)
    ? entries
      .map((entry) => sanitizeImportSpecifier(readCollectorImportSpecifier(entry)))
      .filter(Boolean)
    : []
);

export const finalizeCollectorImportEntries = (store) => {
  if (!(store instanceof Map)) return [];
  return Array.from(store.values())
    .sort((a, b) => (a.specifier < b.specifier ? -1 : (a.specifier > b.specifier ? 1 : 0)))
    .map((entry) => (
      entry?.collectorHint
        ? { specifier: entry.specifier, collectorHint: entry.collectorHint }
        : { specifier: entry.specifier }
    ));
};

export {
  createCommentAwareLineStripper,
  stripInlineCommentAware,
  stripTemplateCommentBlocks
};

/**
 * Collect import-like symbols from JVM-style languages that share `import`,
 * `package`, and optional type-reference keywords (for example `extends`,
 * `implements`, `with`).
 *
 * @param {string} text
 * @param {{precheckTokens?:string[],typeReferenceKeywords?:string[]}} [options]
 * @returns {string[]}
 */
export const collectJvmStyleImports = (
  text,
  {
    precheckTokens = ['import', 'package', 'extends'],
    typeReferenceKeywords = ['extends'],
    includePackageDeclarations = false
  } = {}
) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, precheckTokens);
  const typeKeywordPattern = typeReferenceKeywords
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .join('|');
  const typeRefRegex = typeKeywordPattern
    ? new RegExp(`\\b(?:${typeKeywordPattern})\\s+([A-Za-z_][A-Za-z0-9_.]*)`, 'g')
    : null;
  const addImport = (value) => {
    const token = String(value || '').trim().replace(/[;]+$/g, '');
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const importMatch = line.match(/^\s*import\s+([^\s;]+)/);
    if (importMatch?.[1]) addImport(importMatch[1]);
    if (includePackageDeclarations) {
      const packageMatch = line.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)/);
      if (packageMatch?.[1]) addImport(packageMatch[1]);
    }
    if (!typeRefRegex) continue;
    const typeRefMatches = line.matchAll(typeRefRegex);
    for (const match of typeRefMatches) {
      if (match?.[1]) addImport(match[1]);
    }
  }
  return Array.from(imports);
};

/**
 * Collect `{{> partial}}` template partial references.
 *
 * @param {string} text
 * @param {{lineTokens?:string[]}} [options]
 * @returns {string[]}
 */
export const collectTemplatePartialImports = (text, { lineTokens = ['{{>'] } = {}) => {
  const imports = [];
  const lines = stripTemplateCommentBlocks(text).split('\n');
  const precheck = (value) => lineHasAny(value, lineTokens);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const matches = line.matchAll(/\{\{>\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_./-]+))/g);
    for (const match of matches) {
      const token = sanitizeCollectorImportToken(match[1] || match[2] || match[3]);
      if (!token) continue;
      imports.push(token);
    }
  }
  return imports;
};
