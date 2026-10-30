import { captureParserCommentOccurrences, COMMENT_OCCURRENCE_LIMIT } from './comment-occurrences.js';

export const RUST_COMMENT_LIMITS = Object.freeze({ sourceChars: 8 * 1024 * 1024, nesting: 128, hashes: 255 });
const identifierStart = /^[_\p{ID_Start}]$/u, identifierContinue = /^[_\p{ID_Continue}]$/u;
const codePoint = (text, offset) => offset < text.length ? String.fromCodePoint(text.codePointAt(offset)) : '';
const docRole = (text, start, kind) => kind === 'line'
  ? text.startsWith('//!', start) ? 'inner-candidate' : text.startsWith('///', start) && !text.startsWith('////', start) ? 'outer-candidate' : 'none'
  : text.startsWith('/*!', start) ? 'inner-candidate' : text.startsWith('/**', start)
    && !text.startsWith('/***', start) && !text.startsWith('/**/', start) ? 'outer-candidate' : 'none';

/** Comment lexing only, not a Rust syntax/semantic validity claim.
 * Grammar owners: https://doc.rust-lang.org/reference/comments.html and tokens.html.
 * Original CRLF offsets remain intact; Rust line comments terminate at LF.
 */
export const parseRustCommentOccurrences = (text, { ext = '.rs' } = {}) => {
  const comments = [], owner = { comments };
  const finish = reason => captureParserCommentOccurrences(owner, text, { language: 'rust', dialect: ext,
    unavailableReason: reason, parser: { family: 'rust-comment-lexer', version: '1',
      options: { lineTerminator: 'lf', nestedBlocks: true, sourceNormalization: 'original-utf16' } } });
  if (text.length > RUST_COMMENT_LIMITS.sourceChars) return finish('rust-comment-source-budget');
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (text.startsWith('#!', index) && !text.startsWith('#![', index)) {
    const end = text.indexOf('\n', index); index = end < 0 ? text.length : end + 1;
  }
  while (index < text.length) {
    if (text.startsWith('//', index) || text.startsWith('/*', index)) {
      const start = index, kind = text[index + 1] === '/' ? 'line' : 'block';
      if (kind === 'line') { const end = text.indexOf('\n', index + 2); index = end < 0 ? text.length : end; }
      else {
        let depth = 1; index += 2;
        while (index < text.length && depth) {
          if (text.startsWith('/*', index)) {
            if (++depth > RUST_COMMENT_LIMITS.nesting) return finish('rust-comment-nesting-budget');
            index += 2;
          } else if (text.startsWith('*/', index)) { depth--; index += 2; }
          else index++;
        }
        if (depth) return finish('rust-comment-unterminated-block');
      }
      if (comments.length >= COMMENT_OCCURRENCE_LIMIT) return finish('comment-count-budget');
      const documentationRole = docRole(text, start, kind);
      if (documentationRole !== 'none') for (let cursor = start; cursor < index; cursor++) {
        if (text[cursor] === '\r' && text[cursor + 1] !== '\n') return finish('rust-comment-bare-cr-in-doc');
      }
      comments.push({ start, end: index, documentationRole }); continue;
    }
    // Raw UTF-8, byte and C strings use the same quote/hash termination rule.
    const rawStart = text[index] === 'r' ? index : ['b', 'c'].includes(text[index]) && text[index + 1] === 'r' ? index + 1 : -1;
    if (rawStart >= 0) {
      let quote = rawStart + 1;
      while (text[quote] === '#' && quote - rawStart <= RUST_COMMENT_LIMITS.hashes) quote++;
      if (text[quote] === '#') return finish('rust-comment-raw-string-hash-budget');
      if (text[quote] === '"') {
        const hashes = quote - rawStart - 1;
        if (hashes > RUST_COMMENT_LIMITS.hashes) return finish('rust-comment-raw-string-hash-budget');
        const close = '"' + '#'.repeat(hashes), end = text.indexOf(close, quote + 1);
        if (end < 0) return finish('rust-comment-unterminated-raw-string');
        index = end + close.length; continue;
      }
    }
    if (text[index] === '"') {
      let cursor = index + 1;
      while (cursor < text.length && text[cursor] !== '"') cursor += text[cursor] === '\\' ? 2 : 1;
      if (cursor >= text.length) return finish('rust-comment-unterminated-string');
      index = cursor + 1; continue;
    }
    if (text[index] === "'") {
      let end = index + 1;
      if (text[end] === '\\') {
        end++;
        if (text[end] === 'u' && text[end + 1] === '{') {
          const close = text.indexOf('}', end + 2);
          const digits = close < 0 ? '' : text.slice(end + 2, Math.min(close, end + 18));
          if (close < 0 || close - end > 16 || !/^[0-9a-fA-F][0-9a-fA-F_]*$/.test(digits)
            || digits.replaceAll('_', '').length > 6) return finish('rust-comment-invalid-character');
          end = close + 1;
        } else if (text[end] === 'x' && /^[0-9a-fA-F]{2}$/.test(text.slice(end + 1, end + 3))) end += 3;
        else if (['n', 'r', 't', '\\', '0', '"', "'"].includes(text[end])) end++;
        else return finish('rust-comment-invalid-character');
      } else {
        if (['\n', '\r', '\t'].includes(text[end])) return finish('rust-comment-invalid-character');
        end += codePoint(text, end).length;
      }
      if (text[end] === "'") { index = end + 1; continue; }
      // A lifetime/label has no closing quote. It must not hide later comments.
      let cursor = index + 1, character = codePoint(text, cursor);
      if (!identifierStart.test(character)) return finish('rust-comment-invalid-character-or-lifetime');
      cursor += character.length;
      while (identifierContinue.test(character = codePoint(text, cursor))) cursor += character.length;
      index = cursor; continue;
    }
    index++;
  }
  return finish(null);
};
