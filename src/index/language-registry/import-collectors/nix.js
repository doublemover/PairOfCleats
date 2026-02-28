import { normalizeImportToken } from '../simple-relations.js';
import {
  applyCollectorSourceBudget,
  addCollectorImportEntry,
  collectorImportEntriesToSpecifiers,
  createCollectorScanBudget,
  createCollectorImportEntryStore,
  finalizeCollectorImportEntries,
  lineHasAny
} from './utils.js';

const NIX_SOURCE_BUDGET = Object.freeze({
  maxChars: 524288
});
const NIX_SCAN_BUDGET = Object.freeze({
  maxMatches: 1024,
  maxTokens: 1024
});

const resolveNixCollectorHint = (specifier, { source = null } = {}) => {
  const token = String(specifier || '').trim();
  if (!token) return null;
  const isFlakeInputRef = token.startsWith('github:')
    || token.startsWith('git+')
    || token.startsWith('path:')
    || token.startsWith('flake:')
    || token.startsWith('<');
  if (source === 'getFlake' || source === 'flakeInput' || isFlakeInputRef) {
    return {
      reasonCode: 'IMP_U_RESOLVER_GAP',
      confidence: 0.86,
      detail: source || 'nix-flake-ref'
    };
  }
  return null;
};

const isIdentifierStart = (char) => /[A-Za-z_]/.test(char);
const isIdentifierChar = (char) => /[A-Za-z0-9_-]/.test(char);
const skipWhitespace = (source, start) => {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
};

const readQuotedString = (source, start, quote) => {
  let index = start + 1;
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
      return {
        token: value,
        nextIndex: index + 1
      };
    }
    value += char;
    index += 1;
  }
  return {
    token: value,
    nextIndex: source.length
  };
};

const readIndentedString = (source, start) => {
  let index = start + 2;
  let value = '';
  while (index < source.length) {
    if (source.startsWith("''", index)) {
      return {
        token: value,
        nextIndex: index + 2
      };
    }
    value += source[index];
    index += 1;
  }
  return {
    token: value,
    nextIndex: source.length
  };
};

const readParenthesizedExpression = (source, start) => {
  let index = start;
  let depth = 0;
  let inComment = false;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  while (index < source.length) {
    const char = source[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      index += 1;
      continue;
    }
    if (inSingle) {
      if (source.startsWith("''", index)) {
        inSingle = false;
        index += 2;
      } else {
        index += 1;
      }
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
    if (source.startsWith("''", index)) {
      inSingle = true;
      index += 2;
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
      index += 1;
      if (depth === 0) {
        const inner = source.slice(start + 1, index - 1);
        return {
          token: inner,
          nextIndex: index
        };
      }
      continue;
    }
    index += 1;
  }
  const inner = source.slice(start + 1);
  return {
    token: inner,
    nextIndex: source.length
  };
};

const readNixExpression = (source, start) => {
  let index = skipWhitespace(source, start);
  if (index >= source.length) return null;
  if (source.startsWith("''", index)) {
    const parsed = readIndentedString(source, index);
    return {
      token: parsed.token,
      nextIndex: parsed.nextIndex
    };
  }
  const char = source[index];
  if (char === '"' || char === "'") {
    const parsed = readQuotedString(source, index, char);
    return {
      token: parsed.token,
      nextIndex: parsed.nextIndex
    };
  }
  if (char === '(') {
    const parsed = readParenthesizedExpression(source, index);
    const nested = readNixExpression(parsed.token, 0);
    return {
      token: nested?.token || parsed.token,
      nextIndex: parsed.nextIndex
    };
  }
  const startIndex = index;
  while (index < source.length) {
    const nextChar = source[index];
    if (/\s/.test(nextChar)) break;
    if (/[;,)}\]]/.test(nextChar)) break;
    index += 1;
  }
  return {
    token: source.slice(startIndex, index),
    nextIndex: index
  };
};

const readIdentifier = (source, start) => {
  if (!isIdentifierStart(source[start])) return null;
  let index = start + 1;
  while (index < source.length && isIdentifierChar(source[index])) index += 1;
  return {
    value: source.slice(start, index),
    nextIndex: index
  };
};

const parseInputsAssignment = (source, inputsTokenEnd) => {
  let index = skipWhitespace(source, inputsTokenEnd);
  if (source[index] !== '.') return null;
  index += 1;
  const inputName = readIdentifier(source, index);
  if (!inputName) return null;
  index = skipWhitespace(source, inputName.nextIndex);
  if (source[index] !== '.') return null;
  index += 1;
  const fieldName = readIdentifier(source, index);
  if (!fieldName) return null;
  if (!['url', 'path', 'follows'].includes(fieldName.value)) return null;
  index = skipWhitespace(source, fieldName.nextIndex);
  if (source[index] !== '=') return null;
  index += 1;
  const expression = readNixExpression(source, index);
  if (!expression?.token) return null;
  return {
    token: expression.token,
    nextIndex: expression.nextIndex
  };
};

const parseImportsArray = (source, importsTokenEnd, onToken) => {
  let index = skipWhitespace(source, importsTokenEnd);
  if (source[index] !== '=') return importsTokenEnd;
  index = skipWhitespace(source, index + 1);
  if (source[index] !== '[') return importsTokenEnd;
  index += 1;
  let depth = 1;
  let inComment = false;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      index += 1;
      continue;
    }
    if (char === '#') {
      inComment = true;
      index += 1;
      continue;
    }
    if (source.startsWith("''", index)) {
      const parsed = readIndentedString(source, index);
      if (parsed.token) onToken(parsed.token);
      index = parsed.nextIndex;
      continue;
    }
    if (char === '"' || char === "'") {
      const parsed = readQuotedString(source, index, char);
      if (parsed.token) onToken(parsed.token);
      index = parsed.nextIndex;
      continue;
    }
    if (char === '[') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      index += 1;
      continue;
    }
    if (char === '.' && (source[index + 1] === '/' || source[index + 1] === '.')) {
      let end = index + 2;
      while (end < source.length && /[A-Za-z0-9_./+-]/.test(source[end])) end += 1;
      onToken(source.slice(index, end));
      index = end;
      continue;
    }
    index += 1;
  }
  return index;
};

export const collectNixImportEntries = (text) => {
  const imports = createCollectorImportEntryStore();
  const source = String(text || '');
  const precheck = (value) => lineHasAny(value, [
    'import',
    'callPackage',
    'imports',
    'inputs.',
    'getFlake',
    '.nix'
  ]);
  if (!precheck(source)) return [];
  const sourceBudget = applyCollectorSourceBudget(source, NIX_SOURCE_BUDGET);
  const scanBudget = createCollectorScanBudget(NIX_SCAN_BUDGET);
  const addImport = (value, hintSource = null) => {
    if (scanBudget.exhausted || !scanBudget.consumeToken()) return;
    const cleaned = normalizeImportToken(value);
    addCollectorImportEntry(imports, cleaned, {
      collectorHint: hintSource ? resolveNixCollectorHint(cleaned, { source: hintSource }) : null
    });
  };

  let index = 0;
  let inComment = false;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  const sourceText = sourceBudget.source;
  while (index < sourceText.length) {
    const char = sourceText[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      index += 1;
      continue;
    }
    if (inSingle) {
      if (sourceText.startsWith("''", index)) {
        inSingle = false;
        index += 2;
      } else {
        index += 1;
      }
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
    if (sourceText.startsWith("''", index)) {
      inSingle = true;
      index += 2;
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
    const identifier = readIdentifier(sourceText, index);
    if (!identifier) {
      index += 1;
      continue;
    }
    const token = identifier.value;
    const tokenEnd = identifier.nextIndex;
    if (token === 'import' || token === 'callPackage') {
      if (!scanBudget.consumeMatch()) break;
      const expression = readNixExpression(sourceText, tokenEnd);
      if (expression?.token) addImport(expression.token);
      index = expression?.nextIndex || tokenEnd;
      continue;
    }
    if (token === 'builtins' && sourceText[tokenEnd] === '.') {
      const callIdent = readIdentifier(sourceText, tokenEnd + 1);
      if (callIdent?.value === 'getFlake') {
        if (!scanBudget.consumeMatch()) break;
        const expression = readNixExpression(sourceText, callIdent.nextIndex);
        if (expression?.token) addImport(expression.token, 'getFlake');
        index = expression?.nextIndex || callIdent.nextIndex;
        continue;
      }
    }
    if (token === 'inputs') {
      const assignment = parseInputsAssignment(sourceText, tokenEnd);
      if (assignment?.token) {
        if (!scanBudget.consumeMatch()) break;
        addImport(assignment.token, 'flakeInput');
        index = assignment.nextIndex;
        continue;
      }
    }
    if (token === 'imports') {
      if (!scanBudget.consumeMatch()) break;
      const nextIndex = parseImportsArray(sourceText, tokenEnd, (value) => addImport(value));
      if (nextIndex > tokenEnd) {
        index = nextIndex;
        continue;
      }
    }
    index = tokenEnd;
    if (scanBudget.exhausted) break;
  }
  return finalizeCollectorImportEntries(imports);
};

export const collectNixImports = (text) => (
  collectorImportEntriesToSpecifiers(collectNixImportEntries(text))
);
