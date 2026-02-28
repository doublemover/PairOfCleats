import { sanitizeImportSpecifier } from '../../shared/import-specifier.js';

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

const normalizeLineMarkers = (markers = []) => Array.from(
  new Set(
    markers
      .map((marker) => String(marker || '').trim())
      .filter(Boolean)
  )
).sort((a, b) => b.length - a.length);

const normalizeBlockPairs = (pairs = []) => {
  const normalized = [];
  for (const pair of pairs) {
    const start = String(Array.isArray(pair) ? pair[0] : '').trim();
    const end = String(Array.isArray(pair) ? pair[1] : '').trim();
    if (!start || !end) continue;
    normalized.push([start, end]);
  }
  return normalized;
};

const INLINE_STRIPPER_CACHE = new Map();

/**
 * Create a quote-aware comment stripper that can keep block-comment state
 * across lines.
 *
 * @param {{
 *  markers?: string[],
 *  blockCommentPairs?: Array<[string, string]>,
 *  requireWhitespaceBefore?: boolean
 * }} [options]
 * @returns {(line:string)=>string}
 */
export const createCommentAwareLineStripper = ({
  markers = ['#'],
  blockCommentPairs = [],
  requireWhitespaceBefore = false
} = {}) => {
  const markerList = normalizeLineMarkers(markers);
  const blockPairs = normalizeBlockPairs(blockCommentPairs);
  let activeBlockComment = null;

  return (line) => {
    const source = String(line || '');
    if (!source) return '';
    if (!markerList.length && !blockPairs.length) return source;

    let output = '';
    let i = 0;
    let inSingle = false;
    let inDouble = false;
    let escapedDouble = false;

    while (i < source.length) {
      if (activeBlockComment) {
        const endIndex = source.indexOf(activeBlockComment[1], i);
        if (endIndex < 0) {
          i = source.length;
          break;
        }
        i = endIndex + activeBlockComment[1].length;
        activeBlockComment = null;
        continue;
      }

      if (inDouble) {
        const char = source[i];
        output += char;
        if (escapedDouble) {
          escapedDouble = false;
          i += 1;
          continue;
        }
        if (char === '\\') {
          escapedDouble = true;
          i += 1;
          continue;
        }
        if (char === '"') inDouble = false;
        i += 1;
        continue;
      }

      if (inSingle) {
        const char = source[i];
        output += char;
        if (char === "'") {
          if (source[i + 1] === "'") {
            output += source[i + 1];
            i += 2;
            continue;
          }
          inSingle = false;
        }
        i += 1;
        continue;
      }

      const char = source[i];
      if (char === '"') {
        inDouble = true;
        output += char;
        i += 1;
        continue;
      }
      if (char === "'") {
        inSingle = true;
        output += char;
        i += 1;
        continue;
      }

      let startedBlock = false;
      for (const pair of blockPairs) {
        if (!source.startsWith(pair[0], i)) continue;
        activeBlockComment = pair;
        i += pair[0].length;
        startedBlock = true;
        break;
      }
      if (startedBlock) continue;

      let startedLineComment = false;
      for (const marker of markerList) {
        if (!source.startsWith(marker, i)) continue;
        if (requireWhitespaceBefore && i > 0 && /\S/.test(source[i - 1])) continue;
        startedLineComment = true;
        i = source.length;
        break;
      }
      if (startedLineComment) break;

      output += char;
      i += 1;
    }

    return output.trimEnd();
  };
};

/**
 * Strip inline comments while respecting quoted strings.
 *
 * @param {string} line
 * @param {{markers?: string[], requireWhitespaceBefore?: boolean}} [options]
 * @returns {string}
 */
export const stripInlineCommentAware = (
  line,
  { markers = ['#'], requireWhitespaceBefore = false } = {}
) => {
  const markerList = normalizeLineMarkers(markers);
  const cacheKey = `${markerList.join('\u0001')}|${requireWhitespaceBefore ? '1' : '0'}`;
  let stripper = INLINE_STRIPPER_CACHE.get(cacheKey);
  if (!stripper) {
    stripper = createCommentAwareLineStripper({
      markers: markerList,
      requireWhitespaceBefore
    });
    INLINE_STRIPPER_CACHE.set(cacheKey, stripper);
  }
  return stripper(line);
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
  const lines = String(text || '').split('\n');
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
