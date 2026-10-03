import path from 'node:path';
import { buildLineIndex, offsetToLine } from './lines.js';

const MAX_CHARS = 196608;
const MAX_LINES = 3000;
const MAX_TAGS = 4096;
const MAX_TOKENS = 32768;
const MAX_TOKEN_CHARS = 8192;
const MAX_DEPTH = 64;
const MAX_SCAN_MS = 30;
const EMPTY = Object.freeze([]);
const HEADINGS = new Set(['block', 'macro', 'for', 'if', 'set', 'include', 'extends']);
const COMMON_BLOCKS = new Set(['block', 'for', 'if', 'with', 'filter', 'autoescape']);
const JINJA_BLOCKS = new Set(['macro', 'call']);
const REFERENCE_SKIP = new Set(['block', 'macro', 'for', 'if', 'set', 'include', 'extends', 'import', 'from',
  'as', 'in', 'not', 'and', 'or', 'is', 'else', 'elif', 'true', 'false', 'none', 'True', 'False', 'None',
  'with', 'without', 'context', 'ignore', 'missing', 'only', 'scoped', 'required', 'recursive']);
class TemplateBoundaryError extends Error {}

/** The registered extensions select distinct lexical dialects, not equivalent grammars. */
export const resolveJinjaTemplateDialect = ({ ext, relPath } = {}) => {
  const extension = String(ext || path.posix.extname(String(relPath || '').replace(/\\/gu, '/'))).toLowerCase();
  return ['.django', '.djhtml'].includes(extension) ? 'django' : 'jinja';
};

/** A bounded lexical model only: no external AST, grammar, template loading or evaluation. */
export const createJinjaTemplateStructureParser = ({ now = () => performance.now() } = {}) => {
  let previousText;
  let previousDialect;
  let previousResult;
  return (text, { ext, relPath, maxMs = MAX_SCAN_MS, remainingMs = null } = {}) => {
    const source = String(text || '');
    const dialect = resolveJinjaTemplateDialect({ ext, relPath });
    let metrics = {};
    const fallback = (reason, elapsedMs = 0) => Object.freeze({ parser: 'heuristic-template-unavailable', coverage: 'unavailable',
      dialect, reason, headings: EMPTY, definitions: EMPTY, importEntries: EMPTY, referenceEntries: EMPTY,
      metrics: Object.freeze({ ...metrics, elapsedMs }) });
    if (source.length > MAX_CHARS) return fallback('source-limit');
    const started = Number(now());
    const configured = Number(maxMs);
    const localLimitMs = Number.isFinite(configured) && configured > 0
      ? Math.max(1, Math.min(MAX_SCAN_MS, Math.floor(configured))) : MAX_SCAN_MS;
    const remaining = () => typeof remainingMs === 'function' ? Number(remainingMs()) : Infinity;
    const entryRemaining = remaining();
    metrics = { localLimitMs, effectiveLimitMsAtEntry: Number.isFinite(entryRemaining)
      ? Math.max(0, Math.min(localLimitMs, entryRemaining)) : entryRemaining === Infinity ? localLimitMs : 0 };
    const elapsed = () => Math.max(0, Number(now()) - started);
    const checkTime = () => {
      const measured = elapsed();
      if (!Number.isFinite(measured) || measured >= localLimitMs || !(remaining() > 0)) throw new TemplateBoundaryError('time-limit');
    };
    try {
      checkTime();
      if (source === previousText && dialect === previousDialect) return previousResult;
      const lineIndex = buildLineIndex(source);
      checkTime();
      if (lineIndex.length > MAX_LINES) return fallback('line-limit', elapsed());
      const headings = [];
      const definitions = [];
      const importEntries = [];
      const referenceEntries = [];
      const blocks = [];
      let tagCount = 0;
      let tokenCount = 0;
      const position = (start, end) => ({ start, end, line: offsetToLine(lineIndex, start) - 1 });
      const bodyOf = (start, end, closing) => {
        let bodyStart = start + 2;
        let bodyEnd = end - closing.length;
        if (dialect === 'jinja') {
          if (['-', '+'].includes(source[bodyStart])) bodyStart += 1;
          if (['-', '+'].includes(source[bodyEnd - 1])) bodyEnd -= 1;
        } else if (['-', '+'].includes(source[bodyStart]) || ['-', '+'].includes(source[bodyEnd - 1])) {
          throw new TemplateBoundaryError('unsupported-django-whitespace-control');
        }
        return { bodyStart, bodyEnd, body: source.slice(bodyStart, bodyEnd).trim() };
      };
      const readTag = (start, closing) => {
        if (++tagCount > MAX_TAGS) throw new TemplateBoundaryError('tag-limit');
        if (dialect === 'django') {
          // Django's lexer ends a tag at its first delimiter, including inside
          // quoted text. Do not silently apply Jinja's expression delimiter rules.
          const close = source.indexOf(closing, start + 2);
          checkTime();
          if (close < 0) throw new TemplateBoundaryError('unterminated-tag');
          const newline = source.indexOf('\n', start + 2);
          if (newline >= 0 && newline < close) return null; // Django tag_re has no DOTALL.
          if (close + 2 - start > MAX_TOKEN_CHARS) throw new TemplateBoundaryError('tag-length-limit');
          return { start, end: close + 2, ...bodyOf(start, close + 2, closing) };
        }
        let quote = null;
        const brackets = [];
        for (let index = start + 2; index < source.length; index += 1) {
          if ((index & 127) === 0) checkTime();
          if (index - start > MAX_TOKEN_CHARS) throw new TemplateBoundaryError('tag-length-limit');
          const char = source[index];
          if (quote) {
            if (char === '\\') { index += 1; continue; }
            if (char === quote) quote = null;
            continue;
          }
          if (!brackets.length && source.startsWith(closing, index)) {
            if (index + 2 - start > MAX_TOKEN_CHARS) throw new TemplateBoundaryError('tag-length-limit');
            return { start, end: index + 2, ...bodyOf(start, index + 2, closing) };
          }
          if (char === '"' || char === "'") { quote = char; continue; }
          if ('([{'.includes(char)) {
            if (brackets.length >= MAX_DEPTH) throw new TemplateBoundaryError('depth-limit');
            brackets.push(char);
          } else if (')]}'.includes(char)) {
            if (brackets.pop() !== { ')': '(', ']': '[', '}': '{' }[char]) throw new TemplateBoundaryError('unbalanced-expression');
          }
        }
        throw new TemplateBoundaryError(quote ? 'unterminated-string' : 'unterminated-tag');
      };
      const tokenize = (tag) => {
        const tokens = [];
        let index = tag.bodyStart;
        const append = (kind, start, end, value) => {
          if (++tokenCount > MAX_TOKENS) throw new TemplateBoundaryError('token-limit');
          if (end - start > MAX_TOKEN_CHARS) throw new TemplateBoundaryError('token-length-limit');
          tokens.push({ kind, value, raw: source.slice(start, end), ...position(start, end) });
        };
        while (index < tag.bodyEnd) {
          checkTime();
          const start = index;
          const char = source[index];
          if (/\s/u.test(char)) { index += 1; continue; }
          if (char === '"' || char === "'") {
            const quote = char;
            let value = '';
            let supported = true;
            let closed = false;
            index += 1;
            while (index < tag.bodyEnd) {
              if ((index & 127) === 0) checkTime();
              if (source[index] === quote) { index += 1; closed = true; break; }
              if (source[index] === '\\') {
                index += 1;
                if (source[index] !== quote && source[index] !== '\\') supported = false;
                if (index >= tag.bodyEnd) break;
              }
              value += source[index++];
            }
            if (!closed) throw new TemplateBoundaryError('unterminated-string');
            append('string', start, index, supported ? value : null);
          } else if (/[A-Za-z_]/u.test(char)) {
            index += 1;
            while (index < tag.bodyEnd && /[A-Za-z0-9_]/u.test(source[index])) {
              if ((index & 127) === 0) checkTime();
              index += 1;
            }
            append('identifier', start, index, source.slice(start, index));
          } else {
            index += 1;
            append('punctuation', start, index, char);
          }
        }
        return tokens;
      };
      const skipOpaqueBlock = (tag, terminator) => {
        let cursor = tag.end;
        while (cursor < source.length) {
          checkTime();
          const start = source.indexOf(dialect === 'django' ? '{' : '{%', cursor);
          if (start < 0) break;
          const opening = source.slice(start, start + 2);
          const closing = { '{%': '%}', '{{': '}}', '{#': '#}' }[opening];
          if (!closing) { cursor = start + 1; continue; }
          const close = source.indexOf(closing, start + 2);
          if (close < 0) { cursor = start + 2; continue; }
          const newline = dialect === 'django' ? source.indexOf('\n', start + 2) : -1;
          if (newline >= 0 && newline < close) { cursor = start + 2; continue; }
          if (dialect === 'django' && ++tagCount > MAX_TAGS) throw new TemplateBoundaryError('tag-limit');
          // Opaque content has no expression/string grammar. Only the exact
          // dialect terminator re-enters structural scanning.
          if (opening === '{%' && close - start <= MAX_TOKEN_CHARS) {
            const candidate = dialect === 'jinja' ? bodyOf(start, close + 2, '%}')
              : { body: source.slice(start + 2, close).trim() };
            if (candidate.body === terminator) {
              if (dialect === 'jinja' && ++tagCount > MAX_TAGS) throw new TemplateBoundaryError('tag-limit');
              return close + 2;
            }
          }
          cursor = dialect === 'jinja' ? start + 2 : close + 2;
        }
        throw new TemplateBoundaryError('unterminated-opaque-block');
      };
      const appendReferences = (tokens) => {
        for (let index = 0; index < tokens.length; index += 1) {
          checkTime();
          const token = tokens[index];
          if (token.kind !== 'identifier' || REFERENCE_SKIP.has(token.value)) continue;
          let value = token.value;
          let end = token.end;
          while (tokens[index + 1]?.value === '.' && tokens[index + 2]?.kind === 'identifier') {
            checkTime();
            value += `.${tokens[index + 2].value}`;
            end = tokens[index + 2].end;
            index += 2;
          }
          referenceEntries.push(Object.freeze({ value, ...position(token.start, end) }));
        }
      };
      let cursor = 0;
      while (cursor < source.length) {
        checkTime();
        const start = source.indexOf('{', cursor);
        if (start < 0) break;
        const opening = source.slice(start, start + 2);
        if (!['{%', '{{', '{#'].includes(opening)) { cursor = start + 1; continue; }
        if (opening === '{#') {
          if (++tagCount > MAX_TAGS) throw new TemplateBoundaryError('tag-limit');
          const close = source.indexOf('#}', start + 2);
          if (close < 0) throw new TemplateBoundaryError('unterminated-comment');
          const newline = dialect === 'django' ? source.indexOf('\n', start + 2) : -1;
          if (newline >= 0 && newline < close) { cursor = start + 2; continue; }
          cursor = close + 2;
          continue;
        }
        const tag = readTag(start, opening === '{{' ? '}}' : '%}');
        if (!tag) { cursor = start + 2; continue; }
        const tokens = tokenize(tag);
        cursor = tag.end;
        if (opening === '{{') { appendReferences(tokens); continue; }
        const keyword = tokens[0]?.kind === 'identifier' ? tokens[0].value : null;
        if (!keyword) throw new TemplateBoundaryError('unsupported-directive');
        if ((dialect === 'jinja' && ['verbatim', 'endverbatim', 'comment', 'endcomment'].includes(keyword))
          || (dialect === 'django' && ['raw', 'endraw', 'macro', 'endmacro'].includes(keyword))) {
          throw new TemplateBoundaryError('unsupported-dialect-tag');
        }
        if (keyword === 'raw' && dialect === 'jinja') {
          if (tokens.length !== 1) throw new TemplateBoundaryError('unsupported-raw-arguments');
          cursor = skipOpaqueBlock(tag, 'endraw');
          continue;
        }
        if (dialect === 'django' && ['verbatim', 'comment'].includes(keyword)) {
          if (keyword === 'verbatim' && tag.body !== 'verbatim' && !tag.body.startsWith('verbatim ')) {
            throw new TemplateBoundaryError('unsupported-verbatim-whitespace');
          }
          cursor = skipOpaqueBlock(tag, keyword === 'verbatim' ? `end${tag.body}` : 'endcomment');
          continue;
        }
        if (keyword === 'endraw' || keyword === 'endverbatim' || keyword === 'endcomment') {
          throw new TemplateBoundaryError('unopened-opaque-block');
        }
        const block = COMMON_BLOCKS.has(keyword) || (dialect === 'jinja' && JINJA_BLOCKS.has(keyword))
          || (dialect === 'jinja' && keyword === 'set' && !tokens.some((token) => token.value === '='));
        if (block) {
          if (blocks.length >= MAX_DEPTH) throw new TemplateBoundaryError('depth-limit');
          blocks.push({ keyword, name: tokens[1]?.value });
        } else if (keyword.startsWith('end') && (COMMON_BLOCKS.has(keyword.slice(3)) || JINJA_BLOCKS.has(keyword.slice(3)) || keyword === 'endset')) {
          const parent = blocks.pop();
          if (!parent || parent.keyword !== keyword.slice(3) || (keyword === 'endblock' && tokens[1] && tokens[1].value !== parent.name)) {
            throw new TemplateBoundaryError('unbalanced-block');
          }
          continue;
        }
        const argument = tokens[1]?.kind === 'string' ? tokens[1].raw
          : tag.body.slice(keyword.length).trim().match(/^\S+/u)?.[0];
        if (HEADINGS.has(keyword) && !(dialect === 'django' && keyword === 'set')) headings.push(Object.freeze({ name: argument
          ? `${keyword} ${argument}` : keyword, keyword, ...position(tag.start, tag.end) }));
        const simpleDefinition = tokens[1]?.kind === 'identifier' && (!tokens[2] || tokens[2].start > tokens[1].end
          || (keyword === 'macro' && tokens[2].value === '('));
        if (['block', 'macro'].includes(keyword) && simpleDefinition) {
          definitions.push(Object.freeze({ name: tokens[1].value, ...position(tokens[1].start, tokens[1].end) }));
        }
        const literal = tokens[1];
        const suffix = tokens[2]?.value;
        const literalImport = (dialect === 'django' ? ['extends', 'include'] : ['extends', 'include', 'import', 'from']).includes(keyword) && literal?.kind === 'string'
          && literal.value !== null && (!suffix || ({ include: ['ignore', 'with', 'without', 'only'],
          import: ['as'], from: ['import'], extends: [] }[keyword]).includes(suffix));
        if (literalImport) importEntries.push(Object.freeze({ value: literal.value, ...position(literal.start, literal.end) }));
        appendReferences(tokens);
      }
      if (blocks.length) throw new TemplateBoundaryError('unclosed-block');
      checkTime();
      previousText = source;
      previousDialect = dialect;
      previousResult = Object.freeze({ parser: 'heuristic-template-lexical', coverage: 'heuristic', dialect, reason: null,
        rangeSource: 'application-utf16-lexical', sourceLines: lineIndex.length,
        headings: Object.freeze(headings), definitions: Object.freeze(definitions), importEntries: Object.freeze(importEntries),
        referenceEntries: Object.freeze(referenceEntries), metrics: Object.freeze({ ...metrics, elapsedMs: elapsed(), tagCount, tokenCount }) });
      return previousResult;
    } catch (error) {
      metrics.measuredOverrunMs = Math.max(0, elapsed() - metrics.effectiveLimitMsAtEntry);
      return fallback(error instanceof TemplateBoundaryError ? error.message : 'lexical-failed', elapsed());
    }
  };
};

export const parseJinjaTemplateStructure = createJinjaTemplateStructureParser();
