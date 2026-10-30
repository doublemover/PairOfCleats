import { readQuotedLiteralEnd } from '../../shared/quoted-literal.js';
import { PYTHON_IDENTIFIER_PROFILE, pythonIdentifier, pythonModuleName } from './identifiers.js';
import { buildLineIndex, splitPythonPhysicalLines } from './normalize.js';
import { attachImportExtraction, createImportExtraction } from '../../shared/import-extraction.js';
import {
  addCollectorImportEntry,
  createCollectorImportEntryStore,
  finalizeCollectorImportEntries
} from '../../index/language-registry/import-collectors/utils.js';

const compareCaseAware = (a, b) => (
  String(a).toLowerCase().localeCompare(String(b).toLowerCase()) || String(a).localeCompare(String(b))
);

const normalizeSpecifier = (value, { allowRelative = false } = {}) => {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  const withoutComma = trimmed.replace(/,+$/g, '');
  const modulePart = withoutComma.split(/\s+as\s+/u)[0]?.trim() || '';
  if (!modulePart) return '';
  return pythonModuleName(modulePart, { allowRelative })?.semantic || '';
};

const normalizeUsage = (value) => {
  if (!value) return '';
  const trimmed = String(value).trim().replace(/,+$/g, '');
  return pythonIdentifier(trimmed)?.semantic || '';
};

const replaceWithSpacePreservingNewlines = (value) => value.replace(/[^\r\n]/g, ' ');

const stripPythonStringsAndComments = (text) => {
  const source = String(text || '');
  let index = 0, output = '';
  while (index < source.length) {
    if (source[index] === '#') {
      let end = index;
      while (end < source.length && !/[\r\n]/u.test(source[end])) end++;
      output += replaceWithSpacePreservingNewlines(source.slice(index, end)); index = end;
    } else if (source[index] === "'" || source[index] === '"') {
      const literal = readQuotedLiteralEnd(source, index);
      output += replaceWithSpacePreservingNewlines(source.slice(index, literal.end)); index = literal.end;
    } else output += source[index++];
  }
  return output;
};

const countParenDelta = (statement) => {
  let depth = 0;
  for (const char of String(statement || '')) {
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
  }
  return depth;
};

// Only a compound-header role can introduce an inline suite. Sanitized strings
// preserve source coordinates; brackets and lambda colons remain expressions.
const inlineSuite = statement => {
  if (!/^(?:(?:async\s+)?(?:def|for|with)\b|class\b|if\b|elif\b|else\b|try\b|except\b|finally\b|while\b|case\b)/u.test(statement)) return statement;
  let depth = 0, lambdas = 0;
  for (const match of statement.matchAll(/[A-Za-z_][A-Za-z0-9_]*|[()[\]{}:]/gu)) {
    const token = match[0];
    if (['(','[','{'].includes(token)) depth++;
    else if ([')',']','}'].includes(token)) depth--;
    else if (token === 'lambda' && depth === 0) lambdas++;
    else if (token === ':' && depth === 0) {
      if (lambdas) { lambdas--; continue; }
      return statement.slice(match.index+1).trimStart();
    }
    if (depth < 0) return '';
  }
  return '';
};

const collectPythonImportState = (text) => {
  const source = String(text || '');
  if (!source.includes('import')) {
    return { importEntries: [], usages: [] };
  }

  const sanitized = stripPythonStringsAndComments(source);
  const importStore = createCollectorImportEntryStore();
  const usages = new Set();
  const occurrences = [];
  const statements = [];
  const lines = splitPythonPhysicalLines(sanitized);
  const lineOffsets = buildLineIndex(sanitized);
  let current = '';
  let currentStart = 0, currentEnd = 0;
  let parenDepth = 0;

  const pushStatement = (value) => {
    const normalized = String(value || '').trim();
    if (normalized) statements.push({ text: normalized, start: currentStart, end: currentEnd });
  };

  for (const [lineNumber, rawLine] of lines.entries()) {
    let segmentOffset = 0;
    const segments = rawLine.split(';').map(value => {
      const start = lineOffsets[lineNumber] + segmentOffset + value.length-value.trimStart().length;
      segmentOffset += value.length+1;
      return { value: value.trim(), start, end: lineOffsets[lineNumber]+segmentOffset-1 };
    }).filter(segment => segment.value);
    if (!segments.length) {
      if (!parenDepth) { pushStatement(current); current = ''; }
      continue;
    }
    for (const item of segments) {
      const segment = item.value;
      if (!current) currentStart = item.start;
      currentEnd = item.end;
      const continued = segment.endsWith('\\');
      const normalizedSegment = continued ? segment.slice(0, -1).trimEnd() : segment;
      current = current ? `${current} ${normalizedSegment}` : normalizedSegment;
      parenDepth = Math.max(0, parenDepth + countParenDelta(normalizedSegment));
      if (continued || parenDepth > 0) continue;
      pushStatement(current);
      current = '';
      parenDepth = 0;
    }
  }
  if (current.trim()) {
    pushStatement(current);
  }

  for (const envelope of statements) {
    const statement = inlineSuite(envelope.text);
    const remember = (role, raw, semantic) => {
      if (semantic) occurrences.push({ role, raw: raw.trim(), semantic,
        source: { start: envelope.start, end: envelope.end, encoding: 'utf16le-js-string', range: 'logical-statement-envelope' } });
    };
    let match = statement.match(/^import\s+(.+)$/);
    if (match) {
      const parts = match[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of parts) {
        const [moduleNameRaw, aliasRaw] = part.split(/\s+as\s+/u);
        const moduleName = normalizeSpecifier(moduleNameRaw);
        const alias = normalizeUsage(aliasRaw);
        if (moduleName) addCollectorImportEntry(importStore, moduleName);
        if (alias) usages.add(alias);
        remember('module', moduleNameRaw, moduleName);
        if (alias) remember('alias', aliasRaw, alias);
      }
      continue;
    }

    match = statement.match(/^from\s+(\S+)\s+import\s+(.+)$/u);
    if (!match) continue;
    const moduleName = normalizeSpecifier(match[1], { allowRelative: true });
    if (!moduleName) continue;
    if (moduleName) addCollectorImportEntry(importStore, moduleName);
    remember('module', match[1], moduleName);
    const names = match[2]
      .replace(/^\(/, '')
      .replace(/\)$/, '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    for (const namePart of names) {
      const [nameRaw, aliasRaw] = namePart.split(/\s+as\s+/u);
      const name = normalizeUsage(nameRaw);
      const alias = normalizeUsage(aliasRaw);
      if (name && name !== '*') usages.add(name);
      if (alias) usages.add(alias);
      if (name) remember('member', nameRaw, name);
      if (alias) remember('alias', aliasRaw, alias);
    }
  }

  const importEntries = finalizeCollectorImportEntries(importStore);
  Object.defineProperty(importEntries, 'occurrences', { value: occurrences });
  return {
    importEntries,
    usages: Array.from(usages).sort(compareCaseAware)
  };
};

/**
 * Collect Python import entries while ignoring docstrings/comments/strings.
 *
 * @param {string} text
 * @returns {Array<{specifier:string,collectorHint?:object}>}
 */
export function collectPythonImportEntries(text) {
  const entries = collectPythonImportState(text).importEntries;
  if (!PYTHON_IDENTIFIER_PROFILE.available) attachImportExtraction(entries, createImportExtraction({ entries,
    text: String(text || ''), producerId: 'python', scope: 'legacy-import-array:python', state: 'unavailable',
    reasons: ['legacy_array_producer', 'python_identifier_unicode_profile_unavailable'] }));
  return entries;
}

/**
 * Collect Python import statements and simple usages.
 *
 * @param {string} text
 * @returns {{imports:string[],usages:string[]}}
 */
export function collectPythonImports(text) {
  const state = collectPythonImportState(text);
  return {
    imports: state.importEntries
      .map((entry) => entry.specifier)
      .sort(compareCaseAware),
    usages: state.usages
  };
}
