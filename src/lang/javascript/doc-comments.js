import { createRequire } from 'node:module';
import { parseJavaScriptAst, ownsJavaScriptSyntaxText, getJavaScriptCommentRanges } from './parse.js';

const require = createRequire(import.meta.url);
const LIMITS = Object.freeze({ commentBytes: 64 * 1024, fileBytes: 1024 * 1024,
  tags: 128, typeLength: 8192, typeDepth: 64, traversal: 250000, queued: 50000 });
let commentParser = null, typeParser = null;
const loadCommentParser = () => commentParser ||= require('@es-joy/jsdoccomment').parseComment;
const loadTypeParser = () => typeParser ||= require('jsdoc-type-pratt-parser').parse;
const span = node => ({ start: node?.start ?? node?.range?.[0], end: node?.end ?? node?.range?.[1] });
const valid = (range, text) => Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end)
  && range.start >= 0 && range.end > range.start && range.end <= text.length;
const freezeDocumentation = value => Object.freeze({ ...value,
  range: value.range ? Object.freeze({ ...value.range }) : null,
  parameters: Object.freeze(value.parameters.map(parameter => Object.freeze({ ...parameter }))),
  problems: Object.freeze([...value.problems]) });
const empty = (state, reason = null) => freezeDocumentation({ schemaVersion: 1, dialect: 'jsdoc', state, range: null,
  parameters: [], returns: false, returnType: null, problems: reason ? [reason] : [] });
const shallowType = type => {
  if (type.length > LIMITS.typeLength) return false;
  let depth = 0, quote = null, escaped = false;
  for (const character of type) {
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) { if (character === quote) quote = null; continue; }
    if (['"', "'", '`'].includes(character)) { quote = character; continue; }
    if ('([{<'.includes(character) && ++depth > LIMITS.typeDepth) return false;
    if (')]}>'.includes(character)) depth--;
  }
  return true;
};

const parseDocumentation = (raw, range) => {
  // Missing/broken declared libraries are setup failures, not malformed docs.
  const parseComment = loadCommentParser();
  // Keep declared-package/module failures distinct from malformed annotations.
  const parseType = raw.includes('@param') || raw.includes('@arg') || raw.includes('@return') ? loadTypeParser() : null;
  const result = { ...empty('parsed'), range: { start: range.start, end: range.end } }, parameters = new Map();
  try {
    const block = parseComment(raw);
    if (block.problems?.length || block.tags.length > LIMITS.tags) throw new Error('malformed-or-over-budget-doc-comment');
    for (const tag of block.tags) {
      if (!['param', 'arg', 'argument', 'return', 'returns'].includes(tag.tag)) continue;
      const type = tag.type?.trim() || null;
      if (tag.problems?.length) throw new Error('malformed-doc-tag');
      if (type) {
        if (!shallowType(type)) throw new Error('doc-type-budget');
        (parseType || loadTypeParser())(type, 'jsdoc');
      }
      if (['return', 'returns'].includes(tag.tag)) {
        if (result.returns && result.returnType !== type) throw new Error('conflicting-doc-return-tags');
        result.returns = true; result.returnType = type; continue;
      }
      const name = tag.name?.replace(/^\.\.\./u, '');
      if (!name || name.length > 512 || !/^[\p{ID_Start}_$][\p{ID_Continue}$]*(?:\.[\p{ID_Start}_$][\p{ID_Continue}$]*)*$/u.test(name)) {
        throw new Error('invalid-doc-parameter-name');
      }
      const parameter = { name, type, optional: tag.optional === true,
        default: typeof tag.default === 'string' ? tag.default : null,
        rest: tag.name.startsWith('...') || type?.startsWith('...') === true };
      if (parameters.has(name) && JSON.stringify(parameters.get(name)) !== JSON.stringify(parameter)) throw new Error('conflicting-doc-parameter-tags');
      parameters.set(name, parameter);
    }
    result.parameters = [...parameters.values()];
  } catch {
    result.state = 'malformed'; result.parameters = []; result.returns = false; result.returnType = null;
    result.problems = ['doc-comment-or-jsdoc-type-invalid'];
  }
  return freezeDocumentation(result);
};

/** Associate only actual parser comment ranges with exact declaration/wrapper
 * anchors. A string, template or unrelated body comment cannot supply tags. */
export const createJavaScriptDocCommentOwner = (ast, text) => {
  if (!ast || !ownsJavaScriptSyntaxText(ast, text) || ast.errors?.length) return { forDeclaration: () => empty('unavailable', 'source-parser-unqualified') };
  const comments = getJavaScriptCommentRanges(ast, text);
  if (!comments?.complete) return { forDeclaration: () => empty('unavailable', 'comment-inventory-budget-or-identity') };
  const ranges = comments.ranges;
  const parsed = new Map(); let bytes = 0;
  const preceding = start => {
    let low = 0, high = ranges.length;
    while (low < high) { const mid = (low + high) >>> 1; if (ranges[mid].end <= start) low = mid + 1; else high = mid; }
    return low ? ranges[low - 1] : null;
  };
  const forDeclaration = associations => {
    const anchors = associations.map(value => value.range).filter(range => valid(range, text));
    if (!anchors.length) return empty('unavailable', 'declaration-range-unavailable');
    const start = Math.min(...anchors.map(range => range.start)), range = preceding(start);
    if (!range) return empty('absent');
    // Keywords here belong to parser-proven export/variable wrapper prefixes.
    // Arbitrary source statements and even intervening ordinary comments fence association.
    if (start - range.end > 4096) return empty('absent');
    const gap = text.slice(range.end, start);
    if (!/^\s*(?:(?:export|default|async|declare|const|let|var)\s+)*$/u.test(gap)) return empty('absent');
    if (!text.startsWith('/**', range.start) || !text.startsWith('*/', range.end - 2)) return empty('absent');
    const unavailable = () => freezeDocumentation({ ...empty('unavailable', 'doc-comment-byte-budget'), range });
    if (range.end - range.start > LIMITS.commentBytes) return unavailable();
    const raw = text.slice(range.start, range.end);
    const key = `${range.start}:${range.end}`;
    if (parsed.has(key)) return parsed.get(key);
    const size = Buffer.byteLength(raw);
    if (size > LIMITS.commentBytes || size > LIMITS.fileBytes - bytes) return unavailable();
    bytes += size;
    const result = parseDocumentation(raw, range); parsed.set(key, result); return result;
  };
  return { forDeclaration };
};

const DECLARATIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ClassDeclaration', 'ClassExpression', 'ClassMethod', 'ClassPrivateMethod', 'ObjectMethod']);
const WRAPPERS = new Set(['VariableDeclarator', 'AssignmentExpression', 'MethodDefinition', 'Property',
  'ObjectProperty', 'ClassProperty', 'ClassPrivateProperty', 'PropertyDefinition', 'ExportNamedDeclaration', 'ExportDefaultDeclaration']);
const SKIP = new Set(['loc', 'range', 'tokens', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'parent', 'extra', 'errors']);

/** Compatibility caller without prepared relations: use the same source parser,
 * requiring one unambiguous declaration spanning the chunk (plus trivia). */
export const resolveStandaloneJavaScriptDocumentation = (text, chunk) => {
  if (text.length > LIMITS.fileBytes) return empty('unavailable', 'standalone-parser-byte-budget');
  const ast = parseJavaScriptAst(text);
  if (!ast || !ownsJavaScriptSyntaxText(ast, text) || ast.errors?.length) return empty('unavailable', 'source-parser-unqualified');
  const owner = createJavaScriptDocCommentOwner(ast, text), stack = [{ node: ast, parent: null }], matches = new Map();
  let steps = 0;
  while (stack.length) {
    if (++steps > LIMITS.traversal || stack.length > LIMITS.queued) return empty('unavailable', 'declaration-traversal-budget');
    const { node, parent } = stack.pop();
    if (DECLARATIONS.has(node.type)) {
      const range = span(node), wrapper = WRAPPERS.has(parent?.type) ? span(parent) : range;
      if (valid(range, text) && range.start >= chunk.start && range.end <= chunk.end
        && /^\s*;?\s*$/u.test(text.slice(Math.max(range.end, wrapper.end || 0), chunk.end))) {
        const doc = owner.forDeclaration([{ range }, { range: wrapper }]);
        const prefixEnd = doc.range?.start ?? Math.min(range.start, wrapper.start);
        if (chunk.start === range.start || chunk.start === wrapper.start
          || prefixEnd >= chunk.start && /^\s*$/u.test(text.slice(chunk.start, prefixEnd))) {
          matches.set(doc.range ? `${doc.range.start}:${doc.range.end}` : `${range.start}:${range.end}`, doc);
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (SKIP.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--) if (value[index]?.type) {
          if (stack.length === LIMITS.queued) return empty('unavailable', 'declaration-traversal-budget');
          stack.push({ node: value[index], parent: node });
        }
      } else if (value?.type) {
        if (stack.length === LIMITS.queued) return empty('unavailable', 'declaration-traversal-budget');
        stack.push({ node: value, parent: node });
      }
    }
  }
  return matches.size === 1 ? matches.values().next().value : empty(matches.size ? 'unavailable' : 'absent', matches.size ? 'declaration-association-ambiguous' : null);
};
