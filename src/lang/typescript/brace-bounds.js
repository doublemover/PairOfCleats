import { findBraceDelimitedBodyBounds } from '../brace-bounds.js';

/** TypeScript source comments use ECMAScript line terminators. Keep this
 * grammar policy shared by declaration, relation and fallback flow consumers. */
export const findTypeScriptBodyBounds = (text, start) => findBraceDelimitedBodyBounds(text, start, {
  charLiterals: true, ecmaScriptLineTerminators: true
});
