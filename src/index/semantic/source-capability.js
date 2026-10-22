import { createHash } from 'node:crypto';
const capabilities = new WeakMap();
/** Own immutable decoded UTF-8 text; no borrowed mutable byte view is retained. */
export const createSemanticSourceCapability = text => {
  if (typeof text !== 'string') throw new TypeError('Immutable UTF-8 source text required.');
  const capability = Object.freeze({});
  capabilities.set(capability, Object.freeze({ text, byteLength: Buffer.byteLength(text, 'utf8'), byteHash: createHash('sha256').update(text, 'utf8').digest('hex') }));
  return capability;
};
export const readSemanticSourceCapability = capability => capabilities.get(capability) || null;
