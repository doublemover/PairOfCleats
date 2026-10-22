import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from '../semantic/identity.js';

/** Own one supplied JSON input under the producer's existing byte allowance.
 * Hash the admitted encoding directly, avoiding a second recursive traversal.
 * Callers capture receipt/generation with a time-only check before consulting
 * external cancellation hooks; no caller-owned nested object is retained. */
export const captureSourceLinkedInput = (input, { maxBytes, fail, message, domain = null, check = null }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024
    || typeof fail !== 'function' || typeof message !== 'string' || !message
    || domain !== null && (typeof domain !== 'string' || !domain || domain.includes('\0'))
    || check !== null && typeof check !== 'function') throw new TypeError('Explicit source-linked input bounds and identity contract are required.');
  let encoded;
  try { encoded = canonicalSemanticJson(input, { maxBytes, check }); }
  catch (error) { if (error?.code === 'ERR_SEMANTIC_JSON_BUDGET') throw fail(message); throw error; }
  const value = JSON.parse(encoded);
  const identity = domain === null ? null : createHash('sha256').update(domain + '\0', 'utf8').update(encoded, 'utf8').digest('hex');
  check?.();
  return { value, identity };
};
