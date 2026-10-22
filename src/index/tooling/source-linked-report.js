import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';

const identityEntryBytes = Buffer.byteLength(',"identity":"' + '0'.repeat(64) + '"');

/** Finalize one complete report under its producer's existing byte allowance.
 * The identity field is part of that allowance. Canonical cloning pins retained
 * nested metadata, and unsupported JSON/getters cannot execute during spread. */
export const finalizeSourceLinkedReport = (report, { maxBytes, fail, message, check = null }) => {
  if (!report || typeof report !== 'object' || Array.isArray(report) || !Object.keys(report).length
    || Object.hasOwn(report, 'identity') || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024
    || typeof fail !== 'function' || typeof message !== 'string' || !message || check !== null && typeof check !== 'function') {
    throw new TypeError('An unsigned report and explicit producer byte/error contract are required.');
  }
  check?.();
  const encoded = canonicalSemanticJson(report, { onObjectEncoded: (item, value) => {
    check?.();
    if (Buffer.byteLength(value) + (item === report ? identityEntryBytes : 0) > maxBytes) throw fail(message);
  } });
  const owned = JSON.parse(encoded);
  const result = { ...owned, identity: semanticHash('tooling.source-linked-evidence.v1', owned) };
  check?.();
  return result;
};
