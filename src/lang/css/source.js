import { createCollectorBudgetContext, resolveCollectorBudgetConfig } from '../../index/language-registry/import-collectors/utils.js';
import { sanitizeImportSpecifier } from '../../index/shared/import-specifier.js';

const DEFAULTS = Object.freeze({ maxChars: 524288, maxTokens: 250000, maxMatches: 512, maxLines: 0, maxMs: 0 });
const preparedSources = new WeakMap();
const whitespace = char => char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
const newline = char => char === '\n' || char === '\r' || char === '\f';
const nameChar = char => Boolean(char) && /[A-Za-z0-9_-]|[^\x00-\x7f]/u.test(char);
const nameStart = char => Boolean(char) && /[A-Za-z_-]|[^\x00-\x7f]/u.test(char);
const hex = char => Boolean(char) && /[0-9a-f]/i.test(char);
const replacement = value => value === 0 || value > 0x10ffff || value >= 0xd800 && value <= 0xdfff ? '\ufffd' : String.fromCodePoint(value);
const dialectFor = options => options.ext || options.relPath?.match(/\.[^./\\]+$/u)?.[0] || '.css';
const signature = options => JSON.stringify({ dialect: dialectFor(options).toLowerCase(),
  budget: resolveCollectorBudgetConfig({ options, collectorId: 'imports:css', defaults: DEFAULTS }) });
const qualify = (tokens, source, start, end) => {
  const components = [];
  let depth = 0, component = null, valid = true;
  for (const token of tokens) {
    if (depth === 0) {
      component = { type: token.type, value: token.value?.toLowerCase(), start: token.start, end: token.end };
      components.push(component);
      if (['string', 'url', 'at'].includes(token.type)) valid = false;
    }
    if (['function', '(', '['].includes(token.type)) depth++;
    else if (token.type === ')' || token.type === ']') depth--;
    if (component) component.end = token.end;
  }
  let cursor = 0;
  const take = name => {
    const value = components[cursor];
    if (value?.value !== name || !['ident', 'function'].includes(value.type)) return null;
    cursor++;
    return Object.freeze({ start: value.start, end: value.end, raw: source.slice(value.start, value.end) });
  };
  const layer = take('layer'), supports = components[cursor]?.type === 'function' ? take('supports') : null;
  if (components.slice(cursor).some(value => ['layer', 'supports'].includes(value.value))) valid = false;
  const mediaStart = components[cursor]?.start;
  return { valid, qualifiers: Object.freeze({ start, end, raw: source.slice(start, end), layer, supports,
    media: mediaStart === undefined ? null : Object.freeze({ start: mediaStart, end, raw: source.slice(mediaStart, end) }),
    interpretation: 'source-only' }) };
};

/** Source-owned, bounded lexical facts. No native tree, global source cache,
 * browser activity, URL normalization or preprocessor interpretation is owned here.
 */
export const prepareCssSource = (text, options = {}) => {
  const original = String(text ?? ''), policy = signature(options);
  const existing = options.cssSourceFacts, owner = preparedSources.get(existing);
  const signal = options.abortSignal || options.signal;
  if (owner?.source === original && owner.policy === policy && owner.signal === signal && !signal?.aborted) return existing;
  const context = createCollectorBudgetContext({ text: original, options, collectorId: 'imports:css', defaults: DEFAULTS });
  const { source, scanBudget } = context;
  const imports = [], blocks = [], stack = [], reasons = new Set();
  let index = 0, stopped = false, tokens = 0, topStart = null, ruleAllowed = true, pushed = null, importRegionOpen = true, topAtRule = null;
  const fail = reason => { reasons.add(reason); };
  const check = () => {
    if (signal?.aborted) { fail('cancelled'); stopped = true; }
    if (!scanBudget.consumeTime()) { fail('scan_time'); stopped = true; }
    return !stopped;
  };
  const advance = () => {
    const char = source[index++];
    if ((char === '\n' || char === '\r' && source[index] !== '\n' || char === '\f') && !scanBudget.consumeLine()) {
      fail(scanBudget.timedOut ? 'scan_time' : 'scan_lines'); stopped = true;
    }
    if ((index & 255) === 0) check();
    return char;
  };
  const validEscape = offset => source[offset] === '\\' && offset + 1 < source.length && !newline(source[offset + 1]);
  const escaped = () => {
    advance();
    if (stopped) return '';
    if (index >= source.length || newline(source[index])) return null;
    if (!hex(source[index])) {
      const point = source.codePointAt(index), value = replacement(point);
      advance(); if (point > 0xffff) advance();
      return value;
    }
    let digits = '';
    while (!stopped && digits.length < 6 && hex(source[index])) digits += advance();
    if (whitespace(source[index])) { const char = advance(); if (char === '\r' && source[index] === '\n') advance(); }
    return replacement(Number.parseInt(digits, 16));
  };
  const rawPoint = () => {
    const point = source.codePointAt(index), value = replacement(point);
    advance(); if (point > 0xffff) advance();
    return value;
  };
  const comment = () => {
    advance(); advance();
    while (!stopped && index < source.length && !(source[index] === '*' && source[index + 1] === '/')) advance();
    if (source[index] === '*' && !stopped) { advance(); advance(); }
    else fail('unterminated-comment');
  };
  const trivia = () => {
    while (!stopped && index < source.length) {
      if (whitespace(source[index])) advance();
      else if (source[index] === '/' && source[index + 1] === '*') comment();
      else break;
    }
  };
  const readString = () => {
    const start = index, quote = advance(), valueStart = index;
    let value = '';
    while (!stopped && index < source.length) {
      const char = source[index];
      if (char === quote) { const valueEnd = index; advance(); return { type: 'string', value, start, end: index, valueStart, valueEnd }; }
      if (newline(char)) break;
      if (char === '\\') {
        if (newline(source[index + 1])) {
          advance(); const line = advance(); if (line === '\r' && source[index] === '\n') advance();
        } else {
          const decoded = escaped(); if (decoded === null) break; value += decoded;
        }
      } else value += rawPoint();
    }
    fail('bad-string');
    return { type: 'bad', start, end: index };
  };
  const readName = () => {
    let value = '';
    while (!stopped && index < source.length && (nameChar(source[index]) || source[index] === '\\')) {
      if (source[index] === '\\') { if (!validEscape(index)) break; value += escaped(); }
      else value += rawPoint();
    }
    return value;
  };
  const readUrl = start => {
    advance();
    while (!stopped && whitespace(source[index])) advance();
    let token;
    if (source[index] === '"' || source[index] === "'") {
      token = readString(); trivia();
      if (token.type !== 'bad' && source[index] === ')') { advance(); return { ...token, type: 'url', start, end: index, form: 'url-string' }; }
    } else {
      const valueStart = index;
      let value = '', valueEnd = index, valid = true;
      while (!stopped && index < source.length && source[index] !== ')') {
        const char = source[index];
        if (whitespace(char)) {
          valueEnd = index;
          while (!stopped && whitespace(source[index])) advance();
          if (source[index] !== ')') valid = false;
          break;
        }
        if (char === '"' || char === "'" || char === '(' || /[\x01-\x08\x0b\x0e-\x1f\x7f]/u.test(char)) { valid = false; break; }
        if (char === '\\') { const decoded = escaped(); if (decoded === null) { valid = false; break; } value += decoded; }
        else value += rawPoint();
        valueEnd = index;
      }
      if (valid && !stopped && source[index] === ')') {
        advance(); return { type: 'url', value, start, end: index, valueStart, valueEnd, form: 'url-token' };
      }
    }
    // Consume the bad URL as one token. Its interior cannot invent an at-rule.
    while (!stopped && index < source.length && source[index] !== ')') {
      if (source[index] === '\\' && !newline(source[index + 1])) escaped(); else advance();
    }
    if (source[index] === ')') advance();
    fail('bad-url'); return { type: 'bad', start, end: index };
  };
  const next = () => {
    if (pushed) { const token = pushed; pushed = null; return token; }
    trivia();
    if (!check() || index >= source.length) return null;
    if (!scanBudget.consumeToken()) { fail(scanBudget.timedOut ? 'scan_time' : 'scan_tokens'); stopped = true; return null; }
    tokens++;
    const start = index, char = source[index];
    if (char === '"' || char === "'") return readString();
    if (char === '@' && (nameStart(source[index + 1]) || validEscape(index + 1))) {
      advance(); return { type: 'at', value: readName().toLowerCase(), start, end: index };
    }
    if (nameStart(char) || validEscape(index)) {
      const value = readName();
      if (value.toLowerCase() === 'url' && source[index] === '(') return readUrl(start);
      if (source[index] === '(') { advance(); return { type: 'function', value: value.toLowerCase(), start, end: index }; }
      return { type: 'ident', value, start, end: index };
    }
    advance(); return { type: char, start, end: index };
  };
  const consumeImport = first => {
    const literal = next();
    let valid = literal && ['url', 'string'].includes(literal.type), end = literal?.end ?? first.end;
    if (literal && ['{', '}'].includes(literal.type)) { pushed = literal; fail('malformed-import-rule'); return; }
    const qualifiers = [], nesting = [];
    for (let token = next(); token && !stopped; token = next()) {
      if (token.type === ';' && nesting.length === 0) { end = token.end; break; }
      if (token.type === '{' || token.type === '}' || token.type === 'bad') {
        valid = false; fail('malformed-import-rule'); end = token.end;
        if (token.type !== 'bad') pushed = token;
        break;
      }
      if (token.type === 'function' || token.type === '(' || token.type === '[') {
        if (nesting.length === 128) { valid = false; fail('nesting-budget'); stopped = true; break; }
        nesting.push(token.type === '[' ? ']' : ')');
      } else if (token.type === ')' || token.type === ']') {
        if (nesting.pop() !== token.type) { valid = false; fail('malformed-import-rule'); }
      }
      if (qualifiers.length === 1024) { valid = false; fail('qualifier-budget'); stopped = true; break; }
      qualifiers.push(token); end = token.end;
    }
    if (stopped || nesting.length) valid = false;
    // A truncated source prefix cannot manufacture a completed final rule.
    if (context.sourceBudget.truncated && source[end - 1] !== ';') valid = false;
    if (!valid) { fail('malformed-import-rule'); return; }
    if (!importRegionOpen) { fail('invalid-import-position'); return; }
    const specifier = sanitizeImportSpecifier(literal.value, { literal: true });
    if (!specifier) { fail('empty-or-unsupported-url'); return; }
    if (!scanBudget.consumeMatch()) { fail(scanBudget.timedOut ? 'scan_time' : 'scan_matches'); stopped = true; return; }
    const qualifierStart = literal.end, qualifierEnd = source[end - 1] === ';' ? end - 1 : end;
    const qualified = qualify(qualifiers, source, qualifierStart, qualifierEnd);
    if (!qualified.valid) { fail('unsupported-import-qualifiers'); return; }
    imports.push(Object.freeze({ specifier, provenance: 'parsed-literal', source: 'css-token', coordinateSystem: 'utf16',
      start: first.start, end, literalStart: literal.start, literalEnd: literal.end,
      valueStart: literal.valueStart, valueEnd: literal.valueEnd,
      raw: source.slice(literal.start, literal.end), form: literal.form || 'string',
      context: 'stylesheet-import', qualifiers: qualified.qualifiers }));
  };
  try {
    const dialect = dialectFor(options);
    if (dialect && dialect.toLowerCase() !== '.css') { fail('unsupported-dialect'); stopped = true; }
    for (let token = next(); token && !stopped; token = next()) {
      if (token.type === 'bad') {
        if (stack.length === 0) { topStart ??= token.start; ruleAllowed = false; importRegionOpen = false; }
        continue;
      }
      if (stack.length === 0 && ruleAllowed && token.type === 'at' && token.value === 'import') {
        consumeImport(token); topStart = null; continue;
      }
      if (stack.length === 0 && topStart === null) {
        topStart = token.start; topAtRule = token.type === 'at' ? token.value : null;
        if (!topAtRule) importRegionOpen = false;
      }
      if (token.type === 'function' || token.type === '(' || token.type === '[' || token.type === '{') {
        if (stack.length === 128) { fail('nesting-budget'); stopped = true; break; }
        stack.push({ close: token.type === '{' ? '}' : token.type === '[' ? ']' : ')', start: token.start,
          ruleStart: topStart, outer: stack.length === 0 && token.type === '{' });
      } else if (token.type === ')' || token.type === ']' || token.type === '}') {
        const frame = stack.pop();
        if (frame?.close !== token.type) fail('unbalanced-block');
        if (frame?.outer && frame.close === token.type) {
          if (blocks.length === 5000) { fail('block-budget'); stopped = true; break; }
          blocks.push(Object.freeze({ start: frame.ruleStart, brace: frame.start, end: token.end }));
        }
        if (stack.length === 0) { topStart = null; ruleAllowed = true; importRegionOpen = false; }
      } else if (token.type === ';' && stack.length === 0) {
        if (!['charset', 'layer'].includes(topAtRule)) importRegionOpen = false;
        topStart = null; ruleAllowed = true;
      }
      else if (stack.length === 0) ruleAllowed = false;
    }
    if (stack.length) fail('unbalanced-block');
    if (context.sourceBudget.truncated) fail('source_bytes');
    const coverage = Object.freeze({ state: reasons.has('cancelled') ? 'cancelled' : reasons.has('unsupported-dialect') ? 'unsupported'
      : reasons.size ? 'partial' : 'complete', reasons: Object.freeze([...reasons].sort()),
    sourceLength: original.length, scannedLength: index, tokens, occurrences: imports.length });
    const facts = Object.freeze({ version: 1, dialect: 'css', imports: Object.freeze(imports), blocks: Object.freeze(blocks), coverage });
    preparedSources.set(facts, { source: original, policy, signal });
    if (coverage.state !== 'complete') {
      const diagnostic = { type: 'css-source-coverage', collectorId: 'imports:css', ...coverage };
      if (Array.isArray(options.collectorDiagnostics)) options.collectorDiagnostics.push(diagnostic);
      if (typeof options.onCollectorDiagnostic === 'function') {
        try { options.onCollectorDiagnostic(diagnostic); } catch {}
      }
    }
    return facts;
  } finally { context.finalize(); }
};

export const collectCssImportEntries = (text, options = {}) => {
  const facts = prepareCssSource(text, options), entries = new Map();
  for (const occurrence of facts.imports) {
    if (!entries.has(occurrence.specifier)) entries.set(occurrence.specifier, { specifier: occurrence.specifier, provenance: 'parsed-literal' });
  }
  return Object.defineProperty([...entries.values()], 'coverage', { value: facts.coverage });
};
