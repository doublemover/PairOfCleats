import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../shared/abort.js';
import { encodeBoundedSemanticJson } from '../../index/semantic/canonical-json-bounds.js';
import { getContainedFileSession } from '../../shared/contained-file-resource.js';

export const NATIVE_LEAF_PRODUCT_VERSION = 1;
export const NATIVE_LEAF_PRODUCT_LIMITS = Object.freeze({ inputBytes: 24 * 1024,
  encodedBytes: 128 * 1024, leaves: 4096, work: 32768 });
const encode = value => encodeBoundedSemanticJson(value, { maxBytes: NATIVE_LEAF_PRODUCT_LIMITS.encodedBytes });
const hash = value => createHash('sha256').update(value, 'utf16le').digest('hex');
const boundary = (text, offset) => !(offset > 0 && offset < text.length
  && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
  && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);
const freeze = product => {
  Object.freeze(product.parserIdentity);
  for (const leaf of product.leaves) Object.freeze(leaf);
  Object.freeze(product.leaves); return Object.freeze(product);
};
const payload = product => ({ version: product.version, coordinateUnit: product.coordinateUnit,
  context: product.context, normalization: product.normalization, languageId: product.languageId,
  parserIdentity: product.parserIdentity, inputLength: product.inputLength,
  inputBytes: product.inputBytes, inputHash: product.inputHash, leaves: product.leaves });

/** The native owner emits only ordinary immutable JSON leaves. Whole-input
 * equality is the initial context-equivalence proof; subrange reuse is absent. */
export const createNativeLeafProduct = ({ text, root, languageId, parserIdentity, maxWork, signal }) => {
  if (typeof text !== 'string' || !text || text.length > NATIVE_LEAF_PRODUCT_LIMITS.inputBytes
    || Buffer.byteLength(text) > NATIVE_LEAF_PRODUCT_LIMITS.inputBytes || !root || !parserIdentity
    || root.startIndex !== 0 || root.endIndex !== text.length
    || root.hasError !== false) return null;
  const requestedWork = maxWork == null ? NATIVE_LEAF_PRODUCT_LIMITS.work : Number(maxWork);
  if (!Number.isSafeInteger(requestedWork) || requestedWork < 1) return null;
  const leaves = [], stack = [root], workLimit = Math.min(NATIVE_LEAF_PRODUCT_LIMITS.work, requestedWork);
  let work = 0, estimatedBytes = 1024;
  while (stack.length) {
    throwIfAborted(signal);
    if (++work > workLimit) return null;
    const node = stack.pop(), childCount = node.childCount;
    if (!Number.isSafeInteger(childCount) || childCount < 0 || childCount > workLimit - work) return null;
    if (childCount) {
      if (stack.length + childCount > workLimit) return null;
      for (let index = childCount - 1; index >= 0; index--) {
        const child = node.child(index); if (!child) return null; stack.push(child);
      }
      continue;
    }
    if (node.isMissing === true) return null;
    if (node.isExtra === true) continue;
    const start = node.startIndex, end = node.endIndex, type = node.type;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > text.length
      || !boundary(text,start) || !boundary(text,end) || typeof type !== 'string' || type.length > 128) return null;
    if (start === end || !text.slice(start,end).trim()) continue;
    if (leaves.length >= NATIVE_LEAF_PRODUCT_LIMITS.leaves || leaves.length && start < leaves.at(-1)[1]) return null;
    estimatedBytes += 64 + type.length * 6;
    if (estimatedBytes > NATIVE_LEAF_PRODUCT_LIMITS.encodedBytes) return null;
    leaves.push([start,end,type]);
  }
  const product = { version: NATIVE_LEAF_PRODUCT_VERSION, coordinateUnit: 'utf16', context: 'whole-parser-input',
    normalization: 'consumer-current-dictionary-no-token-sharing', languageId, parserIdentity: { ...parserIdentity },
    inputLength: text.length, inputBytes: Buffer.byteLength(text), inputHash: hash(text), leaves };
  try { product.payloadHash = hash(encode(payload(product))); encode(product); }
  catch (error) { if (error?.code === 'ERR_SEMANTIC_JSON_BUDGET') return null; throw error; }
  return freeze(product);
};

/** Copy bounded serialized handoffs before consumer dictionary callbacks. A
 * mismatched/unsupported product is advisory and retains standalone parsing. */
export const readNativeLeafProduct = ({ product, text, languageId, parserIdentity }) => {
  if (!product || !parserIdentity || typeof text !== 'string' || !text
    || text.length > NATIVE_LEAF_PRODUCT_LIMITS.inputBytes
    || Buffer.byteLength(text) > NATIVE_LEAF_PRODUCT_LIMITS.inputBytes) return null;
  try {
    const input = JSON.parse(encode(product));
    if (Object.keys(input).sort().join('|') !== [...Object.keys(payload(input)), 'payloadHash'].sort().join('|')
      || input.version !== NATIVE_LEAF_PRODUCT_VERSION || input.coordinateUnit !== 'utf16' || input.context !== 'whole-parser-input'
      || input.normalization !== 'consumer-current-dictionary-no-token-sharing' || input.languageId !== languageId
      || input.inputLength !== text.length || input.inputBytes !== Buffer.byteLength(text) || input.inputHash !== hash(text)
      || encode(input.parserIdentity) !== encode(parserIdentity) || !Array.isArray(input.leaves)
      || input.leaves.length > NATIVE_LEAF_PRODUCT_LIMITS.leaves || input.payloadHash !== hash(encode(payload(input)))) return null;
    let end = 0;
    for (const leaf of input.leaves) {
      if (!Array.isArray(leaf) || leaf.length !== 3 || !Number.isSafeInteger(leaf[0]) || !Number.isSafeInteger(leaf[1])
        || leaf[0] < end || leaf[1] <= leaf[0] || leaf[1] > text.length || !boundary(text,leaf[0]) || !boundary(text,leaf[1])
        || typeof leaf[2] !== 'string' || leaf[2].length > 128) return null;
      end = leaf[1];
    }
    return input.leaves;
  } catch { return null; }
};

export const attachNativeLeafProduct = ({ chunks, ...input }) => {
  if (!Array.isArray(chunks)) return chunks;
  const index = chunks.findIndex(chunk => chunk.start === 0 && chunk.end === input.text.length);
  if (index < 0) return chunks;
  let product;
  try { product = createNativeLeafProduct(input); }
  catch (error) {
    if (getContainedFileSession(error) || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
    return chunks;
  }
  return product ? chunks.map((chunk, ordinal) => ordinal === index ? { ...chunk, nativeClassificationLeaves: product } : chunk) : chunks;
};
