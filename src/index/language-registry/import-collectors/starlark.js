import {
  addCollectorImportEntry,
  collectorImportEntriesToSpecifiers,
  createCollectorBudgetContext,
  createCollectorImportEntryStore,
  finalizeCollectorImportEntries,
  lineHasAny
} from './utils.js';

const STARLARK_SOURCE_BUDGET = Object.freeze({
  maxChars: 524288
});
const STARLARK_SCAN_BUDGET = Object.freeze({
  maxMatches: 512,
  maxTokens: 1024
});

const resolveStarlarkCollectorHint = (specifier) => {
  const token = String(specifier || '').trim();
  if (!token) return null;
  if (token.startsWith('@') || token.startsWith('//') || token.startsWith(':')) {
    return {
      reasonCode: 'IMP_U_RESOLVER_GAP',
      confidence: 0.9,
      detail: 'starlark-label'
    };
  }
  return null;
};

const isIdentifierStart = (char) => /[A-Za-z_]/.test(char);
const isIdentifierChar = (char) => /[A-Za-z0-9_.]/.test(char);
const skipWhitespace = (source, start) => {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
};

const readFirstQuotedArgument = (args) => {
  const source = String(args || '');
  let index = skipWhitespace(source, 0);
  if (index >= source.length) return '';
  const quote = source[index];
  if (quote !== '"' && quote !== "'") return '';
  index += 1;
  let value = '';
  let escaped = false;
  while (index < source.length) {
    const char = source[index];
    if (escaped) {
      value += char;
      escaped = false;
      index += 1;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      index += 1;
      continue;
    }
    if (char === quote) {
      return value;
    }
    value += char;
    index += 1;
  }
  return '';
};

const parseBalancedCallBody = (source, openIndex) => {
  let index = openIndex;
  let depth = 0;
  let inComment = false;
  let inSingle = false;
  let inDouble = false;
  let inTripleSingle = false;
  let inTripleDouble = false;
  let escaped = false;
  while (index < source.length) {
    const char = source[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      index += 1;
      continue;
    }
    if (inTripleSingle) {
      if (source.startsWith("'''", index)) {
        inTripleSingle = false;
        index += 3;
      } else {
        index += 1;
      }
      continue;
    }
    if (inTripleDouble) {
      if (source.startsWith('"""', index)) {
        inTripleDouble = false;
        index += 3;
      } else {
        index += 1;
      }
      continue;
    }
    if (inSingle) {
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (char === "'") inSingle = false;
      index += 1;
      continue;
    }
    if (inDouble) {
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (char === '"') inDouble = false;
      index += 1;
      continue;
    }
    if (char === '#') {
      inComment = true;
      index += 1;
      continue;
    }
    if (source.startsWith("'''", index)) {
      inTripleSingle = true;
      index += 3;
      continue;
    }
    if (source.startsWith('"""', index)) {
      inTripleDouble = true;
      index += 3;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      index += 1;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      index += 1;
      continue;
    }
    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          body: source.slice(openIndex + 1, index),
          endIndex: index + 1
        };
      }
      index += 1;
      continue;
    }
    index += 1;
  }
  return null;
};

const collectTopLevelCalls = (source, targetNames, budget) => {
  const calls = [];
  let index = 0;
  let inComment = false;
  let inSingle = false;
  let inDouble = false;
  let inTripleSingle = false;
  let inTripleDouble = false;
  let escaped = false;
  while (index < source.length) {
    const char = source[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      index += 1;
      continue;
    }
    if (inTripleSingle) {
      if (source.startsWith("'''", index)) {
        inTripleSingle = false;
        index += 3;
      } else {
        index += 1;
      }
      continue;
    }
    if (inTripleDouble) {
      if (source.startsWith('"""', index)) {
        inTripleDouble = false;
        index += 3;
      } else {
        index += 1;
      }
      continue;
    }
    if (inSingle) {
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (char === "'") inSingle = false;
      index += 1;
      continue;
    }
    if (inDouble) {
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (char === '"') inDouble = false;
      index += 1;
      continue;
    }
    if (char === '#') {
      inComment = true;
      index += 1;
      continue;
    }
    if (source.startsWith("'''", index)) {
      inTripleSingle = true;
      index += 3;
      continue;
    }
    if (source.startsWith('"""', index)) {
      inTripleDouble = true;
      index += 3;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      index += 1;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      index += 1;
      continue;
    }
    if (!isIdentifierStart(char)) {
      index += 1;
      continue;
    }
    let tokenEnd = index + 1;
    while (tokenEnd < source.length && isIdentifierChar(source[tokenEnd])) tokenEnd += 1;
    const callee = source.slice(index, tokenEnd);
    if (!targetNames.has(callee)) {
      index = tokenEnd;
      continue;
    }
    const openIndex = skipWhitespace(source, tokenEnd);
    if (source[openIndex] !== '(') {
      index = tokenEnd;
      continue;
    }
    if (budget && !budget.consumeMatch()) break;
    const parsed = parseBalancedCallBody(source, openIndex);
    if (!parsed) break;
    calls.push({
      callee,
      args: parsed.body
    });
    index = parsed.endIndex;
  }
  return calls;
};

export const collectStarlarkImportEntries = (text, options = {}) => {
  const imports = createCollectorImportEntryStore();
  const budgetContext = createCollectorBudgetContext({
    text,
    options,
    collectorId: 'starlark',
    defaults: {
      maxChars: STARLARK_SOURCE_BUDGET.maxChars,
      maxMatches: STARLARK_SCAN_BUDGET.maxMatches,
      maxTokens: STARLARK_SCAN_BUDGET.maxTokens,
      maxMs: 0
    }
  });
  const source = budgetContext.source;
  const precheck = (value) => lineHasAny(value, [
    'load',
    'bazel_dep',
    'use_extension',
    'local_path_override'
  ]);
  if (!precheck(source)) return [];
  const scanBudget = budgetContext.scanBudget;
  try {
    const calls = collectTopLevelCalls(
      source,
      new Set(['load', 'bazel_dep', 'use_extension', 'local_path_override']),
      scanBudget
    );

    for (const call of calls) {
      if (!scanBudget.consumeToken()) break;
      if (call.callee === 'load') {
        const specifier = readFirstQuotedArgument(call.args);
        if (!specifier) continue;
        addCollectorImportEntry(imports, specifier, {
          collectorHint: resolveStarlarkCollectorHint(specifier)
        });
        continue;
      }
      if (call.callee === 'bazel_dep') {
        const moduleDep = String(call.args || '').match(/\bname\s*=\s*['"]([^'"]+)['"]/);
        if (!moduleDep?.[1]) continue;
        const specifier = `@${moduleDep[1]}`;
        addCollectorImportEntry(imports, specifier, {
          collectorHint: resolveStarlarkCollectorHint(specifier)
        });
        continue;
      }
      if (call.callee === 'use_extension') {
        const specifier = readFirstQuotedArgument(call.args);
        if (!specifier) continue;
        addCollectorImportEntry(imports, specifier, {
          collectorHint: resolveStarlarkCollectorHint(specifier)
        });
        continue;
      }
      if (call.callee === 'local_path_override') {
        const pathOverride = String(call.args || '').match(/\bpath\s*=\s*['"]([^'"]+)['"]/);
        if (pathOverride?.[1]) addCollectorImportEntry(imports, pathOverride[1]);
      }
      if (scanBudget.exhausted) break;
    }
    return finalizeCollectorImportEntries(imports);
  } finally {
    budgetContext.finalize();
  }
};

export const collectStarlarkImports = (text, options = {}) => (
  collectorImportEntriesToSpecifiers(collectStarlarkImportEntries(text, options))
);
