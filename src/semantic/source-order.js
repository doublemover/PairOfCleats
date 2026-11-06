import { captureSemanticRecordRef } from './reader-input.js';
/** Internal derived operation ordering. UTF-16 code-unit hex has identical
 * ordering under JavaScript strings and SQLite BINARY, including astral paths.
 * The separator sorts before every encoded path unit; positions are numeric.
 */
export const SEMANTIC_OPERATION_INDEX_VERSION = 3;
export const SOURCE_ORDER_FIELD = 'sourceOrder';
export const SOURCE_ORDER_META_KEY = 'semanticSourceOrderVersion';
export const SOURCE_ORDER_VERSION = '1';
const invalid = () => new TypeError('Invalid semantic source-order request.');
export const captureSourcePath = input => {
  if (typeof input !== 'string' || !input.length || input.length > 4096 || /[\\:\0]/.test(input)
    || input.split('/').some(part => !part || part === '.' || part === '..')) throw invalid();
  return input;
};
export const encodeSourcePath = value => {
  let encoded = '';
  for (let index = 0; index < value.length; index++) encoded += value.charCodeAt(index).toString(16).padStart(4, '0');
  return encoded;
};
export const decodeSourceOrderPath = value => {
  const end = value.indexOf('!'), encoded = value.slice(0, end);
  if (end <= 0 || end % 4 || !/^[a-f0-9]+$/.test(encoded)
    || !/^[01][0-9]{32}$/.test(value.slice(end + 1))) throw new Error('Invalid semantic source-order key.');
  let decoded = '';
  for (let index = 0; index < end; index += 4) decoded += String.fromCharCode(parseInt(encoded.slice(index, index + 4), 16));
  return decoded;
};
export const sourceOrderEntry = (record, ref, sourcePath) => record.kind === 'expression' && sourcePath
  ? { field: SOURCE_ORDER_FIELD, value: encodeSourcePath(sourcePath) + '!' + (record.span ? '0' : '1')
    + (record.span || [0, 0]).map(value => String(value).padStart(16, '0')).join(''), ref } : null;
export const sourcePathBounds = sourcePath => {
  const encoded = encodeSourcePath(captureSourcePath(sourcePath));
  return { lower: encoded + '!', upper: encoded + '"' };
};
export const captureSourceOrderCursor = (sourcePath, after) => {
  captureSourcePath(sourcePath);
  if (after === null) return null;
  if (!after || typeof after !== 'object' || Object.keys(after).sort().join(',') !== 'ref,value') throw invalid();
  const value = Object.getOwnPropertyDescriptor(after, 'value'), ref = Object.getOwnPropertyDescriptor(after, 'ref');
  if (!value || !Object.hasOwn(value, 'value') || typeof value.value !== 'string' || value.value.length > 16418
    || !ref || !Object.hasOwn(ref, 'value') || decodeSourceOrderPath(value.value) !== sourcePath) throw invalid();
  return Object.freeze({ value: value.value, ref: Object.freeze(captureSemanticRecordRef(ref.value, invalid)) });
};
export const captureSourceEnumeration = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  for (const key of Object.keys(input)) if (!['prefix', 'after', 'limit'].includes(key)) throw invalid();
  const own = (key, fallback) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor) return fallback;
    if (!Object.hasOwn(descriptor, 'value')) throw invalid();
    return descriptor.value;
  };
  let prefix = own('prefix'), after = own('after', null);
  const limit = own('limit', 32);
  prefix = captureSourcePath(prefix);
  if (after !== null) {
    after = captureSourcePath(after);
    if (after !== prefix && !after.startsWith(prefix + '/')) throw invalid();
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw invalid();
  const encoded = encodeSourcePath(prefix);
  return Object.freeze({ prefix, after, limit, ranges: Object.freeze([
    Object.freeze({ lower: encoded + '!', upper: encoded + '"' }),
    Object.freeze({ lower: encoded + '002f', upper: encoded + '0030' })
  ]), afterKey: after === null ? null : encodeSourcePath(after) + '"' });
};
