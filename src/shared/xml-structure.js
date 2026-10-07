import { buildLineIndex, offsetToLine } from './lines.js';

const MAX_CHARS = 786432;
const MAX_LINES = 20000;
const MAX_TOKENS = 65536;
const MAX_TOKEN_CHARS = 32768;
const MAX_NAME_CHARS = 4096;
const MAX_NODES = 20000;
const MAX_IMPORT_ENTRIES = 4096;
const MAX_DEPTH = 64;
const MAX_MS = 30;
const EMPTY = Object.freeze([]);
const ATTRIBUTES = new Set(['schemalocation', 'href', 'src', 'location', 'file', 'path', 'url', 'project']);
const NAME_RANGES = [[0xc0, 0xd6], [0xd8, 0xf6], [0xf8, 0x2ff], [0x370, 0x37d], [0x37f, 0x1fff],
  [0x200c, 0x200d], [0x2070, 0x218f], [0x2c00, 0x2fef], [0x3001, 0xd7ff], [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd], [0x10000, 0xeffff]];
const nameStart = (code) => code === 0x3a || code === 0x5f || (code >= 65 && code <= 90)
  || (code >= 97 && code <= 122) || NAME_RANGES.some(([start, end]) => code >= start && code <= end);
const nameChar = (code) => nameStart(code) || code === 45 || code === 46 || code === 0xb7
  || (code >= 48 && code <= 57) || (code >= 0x300 && code <= 0x36f) || (code >= 0x203f && code <= 0x2040);
const xmlChar = (code) => [9, 10, 13].includes(code) || (code >= 0x20 && code <= 0xd7ff)
  || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
const whitespace = (char) => char === ' ' || char === '\t' || char === '\r' || char === '\n';
class XmlBoundaryError extends Error {}

/** Application-owned lexical ranges only; declarations/entities are never resolved. */
export const createXmlStructureParser = ({ now = () => performance.now() } = {}) => {
  let previousText;
  let previousResult;
  return (text, { maxMs = MAX_MS, remainingMs = null } = {}) => {
    const source = String(text || '');
    let sourceLines;
    let metrics = {};
    const fallback = (reason, elapsedMs = 0) => Object.freeze({ parser: 'xml-unavailable', coverage: 'unavailable', reason,
      sourceLines, sections: EMPTY, importEntries: EMPTY, metrics: Object.freeze({ ...metrics, elapsedMs }) });
    if (source.length > MAX_CHARS) return fallback('source-limit');
    const started = Number(now());
    const configured = Number(maxMs);
    const localLimitMs = Number.isFinite(configured) && configured > 0 ? Math.max(1, Math.min(MAX_MS, Math.floor(configured))) : MAX_MS;
    const remaining = () => typeof remainingMs === 'function' ? Number(remainingMs()) : Infinity;
    const entryRemaining = remaining();
    metrics = { localLimitMs, effectiveLimitMsAtEntry: Number.isFinite(entryRemaining)
      ? Math.max(0, Math.min(localLimitMs, entryRemaining)) : entryRemaining === Infinity ? localLimitMs : 0 };
    const elapsed = () => Math.max(0, Number(now()) - started);
    const checkTime = () => {
      const measured = elapsed();
      if (!Number.isFinite(measured) || measured >= localLimitMs || !(remaining() > 0)) throw new XmlBoundaryError('time-limit');
    };
    let work = 0;
    const tick = () => { if ((++work & 127) === 0) checkTime(); };
    try {
      checkTime();
      if (source === previousText) return previousResult;
      for (let index = 0; index < source.length;) {
        tick();
        const code = source.codePointAt(index);
        if (!xmlChar(code)) throw new XmlBoundaryError('invalid-character');
        index += code > 0xffff ? 2 : 1;
      }
      const lines = buildLineIndex(source);
      sourceLines = lines.length;
      checkTime();
      if (sourceLines > MAX_LINES) return fallback('line-limit', elapsed());
      const range = (start, end) => Object.freeze({ start, end, line: offsetToLine(lines, start) - 1,
        endLine: offsetToLine(lines, Math.max(start, end - 1)) - 1 });
      let offset = source.startsWith('\uFEFF') ? 1 : 0;
      let tokenCount = 0;
      let nodeCount = 0;
      let unresolvedReferences = 0;
      let ignoredDeclarations = 0;
      let roots = 0;
      const elements = [];
      const stack = [];
      const importEntries = [];
      const token = (start, end) => {
        checkTime();
        if (++tokenCount > MAX_TOKENS) throw new XmlBoundaryError('token-limit');
        if (end - start > MAX_TOKEN_CHARS) throw new XmlBoundaryError('token-length-limit');
      };
      const node = () => { if (++nodeCount > MAX_NODES) throw new XmlBoundaryError('node-limit'); };
      const skipSpace = () => { while (whitespace(source[offset])) { tick(); offset += 1; } };
      const readName = () => {
        const start = offset;
        if (!nameStart(source.codePointAt(offset))) throw new XmlBoundaryError('invalid-name');
        while (offset < source.length && nameChar(source.codePointAt(offset))) {
          tick();
          offset += source.codePointAt(offset) > 0xffff ? 2 : 1;
          if (offset - start > MAX_NAME_CHARS) throw new XmlBoundaryError('name-length-limit');
        }
        return { name: source.slice(start, offset), range: range(start, offset) };
      };
      const referenceFree = (raw) => {
        for (let cursor = raw.indexOf('&'); cursor >= 0; cursor = raw.indexOf('&', cursor + 1)) {
          checkTime();
          const end = raw.indexOf(';', cursor + 1);
          if (end < 0 || end - cursor > MAX_NAME_CHARS) throw new XmlBoundaryError('invalid-reference');
          const value = raw.slice(cursor + 1, end);
          if (value.startsWith('#')) {
            if (!/^#(?:x[0-9a-fA-F]+|[0-9]+)$/u.test(value)) throw new XmlBoundaryError('invalid-reference');
            const code = Number.parseInt(value.slice(value[1] === 'x' ? 2 : 1), value[1] === 'x' ? 16 : 10);
            if (!xmlChar(code)) throw new XmlBoundaryError('invalid-reference');
          } else {
            let index = 0;
            if (!value || !nameStart(value.codePointAt(0))) throw new XmlBoundaryError('invalid-reference');
            while (index < value.length) {
              tick();
              const code = value.codePointAt(index);
              if (!nameChar(code)) throw new XmlBoundaryError('invalid-reference');
              index += code > 0xffff ? 2 : 1;
            }
          }
          unresolvedReferences += 1;
          cursor = end;
        }
        return !raw.includes('&');
      };
      const opaque = (prefix, suffix, reason) => {
        const start = offset;
        const end = source.indexOf(suffix, start + prefix.length);
        if (end < 0) throw new XmlBoundaryError(reason);
        offset = end + suffix.length;
        token(start, offset);
        return source.slice(start + prefix.length, end);
      };
      while (offset < source.length) {
        checkTime();
        if (source[offset] !== '<') {
          const start = offset;
          const end = source.indexOf('<', start);
          offset = end < 0 ? source.length : end;
          const textValue = source.slice(start, offset);
          if (!stack.length) for (const char of textValue) {
            tick();
            if (!whitespace(char)) throw new XmlBoundaryError('invalid-text');
          }
          if (textValue.includes(']]>')) throw new XmlBoundaryError('invalid-text');
          referenceFree(textValue);
          token(start, offset);
          continue;
        }
        if (source.startsWith('<!--', offset)) {
          const comment = opaque('<!--', '-->', 'unterminated-comment');
          if (comment.includes('--') || comment.endsWith('-')) throw new XmlBoundaryError('invalid-comment');
          continue;
        }
        if (source.startsWith('<![CDATA[', offset)) {
          if (!stack.length) throw new XmlBoundaryError('misplaced-cdata');
          opaque('<![CDATA[', ']]>', 'unterminated-cdata');
          continue;
        }
        if (source.startsWith('<?', offset)) { opaque('<?', '?>', 'unterminated-instruction'); continue; }
        if (source.startsWith('<!DOCTYPE', offset)) {
          if (roots || stack.length || ignoredDeclarations) throw new XmlBoundaryError('misplaced-declaration');
          const start = offset;
          offset += 9;
          if (!whitespace(source[offset])) throw new XmlBoundaryError('invalid-declaration');
          let quote = null;
          let depth = 0;
          let closed = false;
          while (offset < source.length) {
            tick();
            if (offset - start > MAX_TOKEN_CHARS) throw new XmlBoundaryError('token-length-limit');
            const char = source[offset];
            if (quote) { if (char === quote) quote = null; offset += 1; continue; }
            if (source.startsWith('<!--', offset)) { opaque('<!--', '-->', 'unterminated-comment'); continue; }
            if (source.startsWith('<?', offset)) { opaque('<?', '?>', 'unterminated-instruction'); continue; }
            if (char === '"' || char === "'") quote = char;
            else if (char === '[') { if (++depth > MAX_DEPTH) throw new XmlBoundaryError('depth-limit'); }
            else if (char === ']') { if (--depth < 0) throw new XmlBoundaryError('invalid-declaration'); }
            else if (char === '>' && !depth) { offset += 1; closed = true; break; }
            offset += 1;
          }
          if (!closed) throw new XmlBoundaryError('unterminated-declaration');
          ignoredDeclarations += 1;
          token(start, offset);
          continue;
        }
        if (source.startsWith('<!', offset)) throw new XmlBoundaryError('unsupported-declaration');
        const start = offset++;
        const closing = source[offset] === '/';
        if (closing) offset += 1;
        const { name, range: nameRange } = readName();
        if (closing) {
          skipSpace();
          if (source[offset++] !== '>' || stack.at(-1)?.name !== name) throw new XmlBoundaryError('unbalanced-element');
          const element = stack.pop();
          element.end = offset;
          token(start, offset);
          continue;
        }
        if (!stack.length && ++roots > 1) throw new XmlBoundaryError('multiple-roots');
        if (stack.length >= MAX_DEPTH) throw new XmlBoundaryError('depth-limit');
        node();
        const element = { name, start, end: null, depth: stack.length, nameRange, attributes: [] };
        const seenAttributes = new Set();
        let empty = false;
        let closed = false;
        while (offset < source.length) {
          checkTime();
          const beforeSpace = offset;
          skipSpace();
          if (source[offset] === '>') { offset += 1; closed = true; break; }
          if (source.startsWith('/>', offset)) { offset += 2; empty = true; closed = true; break; }
          if (offset === beforeSpace) throw new XmlBoundaryError('invalid-attribute');
          const attributeStart = offset;
          const attribute = readName();
          if (seenAttributes.has(attribute.name)) throw new XmlBoundaryError('duplicate-attribute');
          seenAttributes.add(attribute.name);
          skipSpace();
          if (source[offset++] !== '=') throw new XmlBoundaryError('invalid-attribute');
          skipSpace();
          const quote = source[offset++];
          if (quote !== '"' && quote !== "'") throw new XmlBoundaryError('invalid-attribute');
          const valueStart = offset;
          while (offset < source.length && source[offset] !== quote) {
            tick();
            if (source[offset] === '<') throw new XmlBoundaryError('invalid-attribute');
            if (offset - valueStart > MAX_TOKEN_CHARS) throw new XmlBoundaryError('token-length-limit');
            offset += 1;
          }
          if (source[offset] !== quote) throw new XmlBoundaryError('unterminated-attribute');
          const raw = source.slice(valueStart, offset);
          const literal = referenceFree(raw);
          const valueRange = range(valueStart, offset++);
          token(attributeStart, offset);
          node();
          element.attributes.push(Object.freeze({ name: attribute.name, nameRange: attribute.range,
            value: literal ? raw : null, unresolved: !literal, valueRange }));
          const includeTag = /^(?:[^:]+:)?(?:include|import)$/iu.test(name);
          const selected = includeTag && ATTRIBUTES.has(attribute.name.toLowerCase());
          const schema = attribute.name === 'xsi:schemaLocation' || (selected && attribute.name.toLowerCase() === 'schemalocation');
          if (!literal || (!selected && !schema)) continue;
          const values = schema ? [...raw.matchAll(/\S+/gu)].filter((match) => /[\/.:]/u.test(match[0])) : [{ 0: raw, index: 0 }];
          for (const match of values) {
            checkTime();
            if (importEntries.length >= MAX_IMPORT_ENTRIES) throw new XmlBoundaryError('import-limit');
            importEntries.push(Object.freeze({ value: match[0], ...range(valueStart + match.index, valueStart + match.index + match[0].length),
              nameRange: attribute.range, elementName: name }));
          }
        }
        if (!closed) throw new XmlBoundaryError('unterminated-element');
        token(start, offset);
        element.openingRange = range(start, offset);
        elements.push(element);
        if (empty) element.end = offset;
        else stack.push(element);
      }
      checkTime();
      if (stack.length || roots !== 1) throw new XmlBoundaryError('unbalanced-element');
      const sections = [];
      for (const element of elements) {
        checkTime();
        if (element.depth !== 1) continue;
        sections.push(Object.freeze({ name: element.name, start: element.start, end: element.end,
          nameRange: element.nameRange, openingRange: element.openingRange, attributes: Object.freeze(element.attributes) }));
      }
      checkTime();
      previousText = source;
      previousResult = Object.freeze({ parser: 'xml-lexical', coverage: 'partial', reason: null,
        rangeSource: 'application-utf16-lexer', sourceLines, unresolvedReferences, ignoredDeclarations,
        sections: Object.freeze(sections), importEntries: Object.freeze(importEntries),
        metrics: Object.freeze({ ...metrics, elapsedMs: elapsed(), tokenCount, nodeCount }) });
      return previousResult;
    } catch (error) {
      metrics.measuredOverrunMs = Math.max(0, elapsed() - metrics.effectiveLimitMsAtEntry);
      return fallback(error instanceof XmlBoundaryError ? error.message : 'parse-failed', elapsed());
    }
  };
};

export const parseXmlStructure = createXmlStructureParser();
