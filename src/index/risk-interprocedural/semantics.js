import { compileSafeRegex, normalizeSafeRegexConfig } from '../../shared/safe-regex.js';
import { toArray } from '../../shared/iterables.js';

export const SUPPORTED_RISK_INTERPROCEDURAL_SEMANTIC_KINDS = new Set([
  'wrapper',
  'propagator',
  'builder',
  'callback',
  'asyncHandoff'
]);

const MAX_DIAGNOSTICS = 50;

const normalizeStringList = (values) => {
  const normalized = Array.from(new Set(toArray(values)
    .map((entry) => (entry == null ? null : String(entry).trim()))
    .filter(Boolean)));
  normalized.sort();
  return normalized;
};

const normalizeIndexList = (values) => {
  const normalized = Array.from(new Set(toArray(values)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .map((entry) => Math.floor(entry))));
  normalized.sort((a, b) => a - b);
  return normalized;
};

export const createRiskInterproceduralSemanticsDiagnostics = (limit = MAX_DIAGNOSTICS) => ({
  warnings: [],
  limit
});

const appendDiagnostic = (diagnostics, detail) => {
  if (!diagnostics || !detail) return;
  if (!Array.isArray(diagnostics.warnings)) return;
  if (diagnostics.warnings.length >= (diagnostics.limit || MAX_DIAGNOSTICS)) return;
  diagnostics.warnings.push(detail);
};

const buildSemanticDiagnostic = ({ code, message, entry, field = null }) => ({
  code,
  message,
  semanticId: entry?.id || null,
  semanticKind: entry?.kind || null,
  semanticName: entry?.name || null,
  field
});

const extractPrefilter = (pattern) => {
  const source = typeof pattern === 'string' ? pattern : pattern?.source;
  if (!source) return null;
  const scrubbed = source.replace(/\\./g, ' ');
  const tokens = scrubbed.match(/[A-Za-z0-9_$]{3,}/g);
  if (!tokens || !tokens.length) return null;
  tokens.sort((a, b) => b.length - a.length);
  return tokens[0] || null;
};

const compilePattern = (pattern, regexConfig, diagnostics, entry, field) => {
  const compiledResult = compileSafeRegex(pattern, '', regexConfig);
  if (compiledResult.regex) {
    const compiled = compiledResult.regex;
    const prefilter = extractPrefilter(pattern);
    if (prefilter) {
      compiled.prefilter = prefilter;
      if (compiled.flags && compiled.flags.includes('i')) {
        compiled.prefilterLower = prefilter.toLowerCase();
      }
    }
    return compiled;
  }
  if (compiledResult.error) {
    appendDiagnostic(diagnostics, buildSemanticDiagnostic({
      code: compiledResult.error.code || 'INVALID_SEMANTIC_PATTERN',
      message: compiledResult.error.message || 'Semantic regex compilation failed.',
      entry,
      field
    }));
  }
  return null;
};

const normalizeSemanticEntry = (entry, diagnostics) => {
  if (!entry || typeof entry !== 'object') return null;
  const kind = typeof entry.kind === 'string' ? entry.kind.trim() : '';
  if (!SUPPORTED_RISK_INTERPROCEDURAL_SEMANTIC_KINDS.has(kind)) {
    appendDiagnostic(diagnostics, buildSemanticDiagnostic({
      code: 'UNSUPPORTED_SEMANTICS_KIND',
      message: `Unsupported semantics kind "${kind || 'unknown'}".`,
      entry,
      field: 'kind'
    }));
    return null;
  }
  const patterns = normalizeStringList(entry.patterns);
  if (!patterns.length) {
    appendDiagnostic(diagnostics, buildSemanticDiagnostic({
      code: 'INVALID_SEMANTICS_PATTERNS',
      message: 'Custom semantics entries must declare at least one pattern.',
      entry,
      field: 'patterns'
    }));
    return null;
  }
  const name = typeof entry.name === 'string' && entry.name.trim()
    ? entry.name.trim()
    : patterns[0];
  const id = typeof entry.id === 'string' && entry.id.trim()
    ? entry.id.trim()
    : `${kind}:${name}`;
  return {
    id,
    kind,
    name,
    languages: normalizeStringList(entry.languages),
    frameworks: normalizeStringList(entry.frameworks),
    patterns,
    fromArgs: normalizeIndexList(entry.fromArgs ?? entry.inputArgs),
    toParams: normalizeIndexList(entry.toParams ?? entry.outputParams),
    taintHints: normalizeStringList(entry.taintHints)
  };
};

const normalizeRegexConfig = (regexConfig) => normalizeSafeRegexConfig({
  ...(regexConfig && typeof regexConfig === 'object' ? regexConfig : {}),
  flags: 'i'
});

export const normalizeRiskInterproceduralSemantics = (entries, { regexConfig, diagnostics } = {}) => {
  const normalized = [];
  const effectiveRegexConfig = normalizeRegexConfig(regexConfig);
  for (const entry of toArray(entries)) {
    const semantic = normalizeSemanticEntry(entry, diagnostics);
    if (!semantic) continue;
    const validPatterns = semantic.patterns.filter((pattern) => (
      compilePattern(pattern, effectiveRegexConfig, diagnostics, semantic, 'patterns')
    ));
    if (!validPatterns.length) continue;
    normalized.push({
      ...semantic,
      patterns: validPatterns
    });
  }
  normalized.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
  return normalized;
};

export const compileRiskInterproceduralSemantics = (entries, { regexConfig, diagnostics } = {}) => {
  const effectiveRegexConfig = normalizeRegexConfig(regexConfig);
  return normalizeRiskInterproceduralSemantics(entries, { regexConfig: effectiveRegexConfig, diagnostics }).map((entry) => ({
    ...entry,
    compiledPatterns: entry.patterns
      .map((pattern) => compilePattern(pattern, effectiveRegexConfig, diagnostics, entry, 'patterns'))
      .filter(Boolean)
  }));
};
