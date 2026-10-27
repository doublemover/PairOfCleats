import { createHash } from 'node:crypto';

export const COMMENT_OCCURRENCE_LIMIT = 20000;
export const COMMENT_OCCURRENCE_POLICY = 1;
const syntaxProducts = new WeakMap();
const productSources = new WeakMap();
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

/** Parser owners publish spans once. No AST, native handle or cleaned text escapes. */
export const captureParserCommentOccurrences = (ast, text, { parser, language, dialect }) => {
  const input = Array.isArray(ast?.comments) ? ast.comments : null;
  let reason = !input ? 'parser-comments-unavailable' : input.length > COMMENT_OCCURRENCE_LIMIT
    ? 'comment-count-budget' : ast.errors?.length ? 'parser-recovered-errors' : null;
  const ranges = [];
  if (!reason) for (const comment of input) {
    const start = comment.start ?? comment.range?.[0], end = comment.end ?? comment.range?.[1];
    const kind = text.startsWith('//', start) ? 'line' : text.startsWith('/*', start) ? 'block' : null;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length || !kind) {
      reason = 'invalid-parser-comment-range'; break;
    }
    ranges.push(Object.freeze({ start, end, kind,
      documentationRole: kind === 'block' && text.startsWith('/**', start) ? 'candidate' : 'none',
      attachment: 'unassociated' }));
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  if (!reason && ranges.some((range, index) => index > 0 && range.start < ranges[index - 1].end)) reason = 'overlapping-parser-comments';
  let sourceHash;
  const source = Object.freeze({ coordinateUnit: 'utf16', length: text.length,
    get sha256() { return sourceHash ||= createHash('sha256').update(text, 'utf16le').digest('hex'); } });
  const parserIdentity = JSON.parse(JSON.stringify(parser));
  const product = Object.freeze({ schemaVersion: 1, policyVersion: COMMENT_OCCURRENCE_POLICY,
    source, parser: freeze(parserIdentity), language, dialect,
    complete: !reason, coverage: reason ? 'unavailable' : 'complete', reason,
    ranges: Object.freeze(reason ? [] : ranges) });
  syntaxProducts.set(ast, product); productSources.set(product, text);
  return product;
};

export const getParserCommentOccurrences = (ast, text) => {
  const product = syntaxProducts.get(ast);
  return product && productSources.get(product) === text ? product : null;
};

export const ownsCommentOccurrenceSource = (product, text) => productSources.has(product) && productSources.get(product) === text;
