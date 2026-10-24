import { findMatchingParen, findTopLevelIndex, splitSignatureParameters } from './shared.js';
import { setOwn } from '../../../shared/object-record.js';
import { normalizeTypeWhitespace } from '../../../shared/type-normalization.js';

const FUNCTION_HEAD = /^(?:<\?php\s*)?(?:\[virtual\]\s*)?(?:(?:public|protected|private|abstract|final|static)\s+)*(?:function\s*&?\s*)?(?<name>\\?[\p{ID_Start}_][\p{ID_Continue}\\]*(?:(?:::|->)[\p{ID_Start}_][\p{ID_Continue}]*)?)\s*\(/u;
const typeDisplay = value => {
  const result = normalizeTypeWhitespace(value);
  if (!result || /[;=]/u.test(result) || splitSignatureParameters(result)?.length !== 1) return null;
  return result;
};

/** Retain PHP/Phpactor function and completion-label presentation. `$` belongs
 * to parameter syntax, not its type. The result is display evidence, including
 * PHPDoc shapes/generics supplied by a server, never an authoritative type IR or
 * a resolved dynamic/magic dispatch target. Missing declared/inferred text stays
 * unknown rather than becoming implicit mixed/void. */
export const parsePhpSignature = detail => {
  if (typeof detail !== 'string' || !detail.trim() || detail.length > 65536) return null;
  const signature = detail.trim();
  const head = FUNCTION_HEAD.exec(signature);
  if (!head) return null;
  const open = head[0].length - 1, close = findMatchingParen(signature, open);
  if (close < 0) return null;
  const suffix = signature.slice(close + 1).trim().replace(/;$/u, '').trim();
  let returnType = null;
  if (suffix) {
    if (!suffix.startsWith(':')) return null;
    returnType = typeDisplay(suffix.slice(1));
    if (!returnType) return null;
  }
  const parts = splitSignatureParameters(signature.slice(open + 1, close));
  if (!parts) return null;
  const paramNames = [], paramTypes = {};
  for (const part of parts) {
    const equal = findTopLevelIndex(part, '=');
    const declaration = (equal < 0 ? part : part.slice(0, equal)).trim();
    const match = /\$(?<name>[\p{ID_Start}_][\p{ID_Continue}]*)$/u.exec(declaration);
    if (!match || paramNames.includes(match.groups.name)) return null;
    const name = match.groups.name;
    const prefix = declaration.slice(0, match.index).trim()
      .replace(/\.\.\.\s*$/u, '').replace(/&\s*$/u, '')
      .replace(/^(?:(?:public|protected|private|readonly)\s+)+/u, '').trim();
    const type = prefix ? typeDisplay(prefix) : null;
    if (prefix && !type) return null;
    paramNames.push(name);
    if (type) setOwn(paramTypes, name, type);
  }
  return { signature, returnType, paramNames, paramTypes };
};
