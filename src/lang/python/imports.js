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
  const modulePart = withoutComma.split(/\s+as\s+/i)[0]?.trim() || '';
  if (!modulePart) return '';
  if (allowRelative && /^\.+[A-Za-z0-9_\.]*$/.test(modulePart)) return modulePart;
  if (/^[A-Za-z_][A-Za-z0-9_\.]*$/.test(modulePart)) return modulePart;
  return '';
};

const normalizeUsage = (value) => {
  if (!value) return '';
  const trimmed = String(value).trim().replace(/,+$/g, '');
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : '';
};

const replaceWithSpacePreservingNewlines = (value) => value.replace(/[^\r\n]/g, ' ');

const stripPythonStringsAndComments = (text) => {
  const source = String(text || '');
  const length = source.length;
  let index = 0;
  let output = '';
  let state = 'code';
  let quoteChar = null;

  const startsWithTripleQuote = (offset, quote) => (
    source[offset] === quote && source[offset + 1] === quote && source[offset + 2] === quote
  );

  while (index < length) {
    const char = source[index];
    if (state === 'code') {
      if (char === '#') {
        let end = index;
        while (end < length && source[end] !== '\n' && source[end] !== '\r') {
          end += 1;
        }
        output += replaceWithSpacePreservingNewlines(source.slice(index, end));
        index = end;
        continue;
      }
      if (char === '\'' || char === '"') {
        quoteChar = char;
        if (startsWithTripleQuote(index, char)) {
          state = char === '\'' ? 'triple-single' : 'triple-double';
          output += '   ';
          index += 3;
          continue;
        }
        state = char === '\'' ? 'single' : 'double';
        output += ' ';
        index += 1;
        continue;
      }
      output += char;
      index += 1;
      continue;
    }

    if (state === 'single' || state === 'double') {
      if (char === '\\') {
        const nextIndex = Math.min(length, index + 2);
        output += replaceWithSpacePreservingNewlines(source.slice(index, nextIndex));
        index = nextIndex;
        continue;
      }
      output += (char === '\r' || char === '\n') ? char : ' ';
      if (char === quoteChar) {
        state = 'code';
        quoteChar = null;
      }
      index += 1;
      continue;
    }

    if (state === 'triple-single' || state === 'triple-double') {
      if (startsWithTripleQuote(index, quoteChar)) {
        output += '   ';
        index += 3;
        state = 'code';
        quoteChar = null;
        continue;
      }
      output += (char === '\r' || char === '\n') ? char : ' ';
      index += 1;
      continue;
    }
  }

  return output;
};

const countParenDelta = (statement) => {
  let depth = 0;
  for (const char of String(statement || '')) {
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
  }
  return depth;
};

const collectPythonImportState = (text) => {
  const source = String(text || '');
  if (!source.includes('import')) {
    return { importEntries: [], usages: [] };
  }

  const sanitized = stripPythonStringsAndComments(source);
  const importStore = createCollectorImportEntryStore();
  const usages = new Set();
  const statements = [];
  const lines = sanitized.split(/\r?\n/);
  let current = '';
  let parenDepth = 0;

  const pushStatement = (value) => {
    const normalized = String(value || '').trim();
    if (normalized) statements.push(normalized);
  };

  for (const rawLine of lines) {
    const segments = String(rawLine || '')
      .split(';')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (!segments.length) {
      if (!parenDepth) pushStatement(current);
      current = '';
      continue;
    }
    for (const segment of segments) {
      const continued = segment.endsWith('\\');
      const normalizedSegment = continued ? segment.slice(0, -1).trimEnd() : segment;
      current = current ? `${current} ${normalizedSegment}` : normalizedSegment;
      parenDepth += countParenDelta(normalizedSegment);
      if (continued || parenDepth > 0) continue;
      pushStatement(current);
      current = '';
      parenDepth = 0;
    }
  }
  if (current.trim()) {
    pushStatement(current);
  }

  for (const statement of statements) {
    let match = statement.match(/^import\s+(.+)$/);
    if (match) {
      const parts = match[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of parts) {
        const [moduleNameRaw, aliasRaw] = part.split(/\s+as\s+/i);
        const moduleName = normalizeSpecifier(moduleNameRaw);
        const alias = normalizeUsage(aliasRaw);
        if (moduleName) addCollectorImportEntry(importStore, moduleName);
        if (alias) usages.add(alias);
      }
      continue;
    }

    match = statement.match(/^from\s+(\.+[A-Za-z0-9_\.]*|[A-Za-z_][A-Za-z0-9_\.]*)\s+import\s+(.+)$/);
    if (!match) continue;
    const moduleName = normalizeSpecifier(match[1], { allowRelative: true });
    if (moduleName) addCollectorImportEntry(importStore, moduleName);
    const names = match[2]
      .replace(/^\(/, '')
      .replace(/\)$/, '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    for (const namePart of names) {
      const [nameRaw, aliasRaw] = namePart.split(/\s+as\s+/i);
      const name = normalizeUsage(nameRaw);
      const alias = normalizeUsage(aliasRaw);
      if (name && name !== '*') usages.add(name);
      if (alias) usages.add(alias);
    }
  }

  return {
    importEntries: finalizeCollectorImportEntries(importStore),
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
  return collectPythonImportState(text).importEntries;
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
