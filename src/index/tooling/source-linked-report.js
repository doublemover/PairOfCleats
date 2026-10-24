import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from '../semantic/identity.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';

const identityEntryBytes = Buffer.byteLength(',"identity":"' + '0'.repeat(64) + '"');

/** Finalize one complete report under its producer's existing byte allowance.
 * The identity field is part of that allowance. Canonical cloning pins retained
 * nested metadata, and unsupported JSON/getters cannot execute during spread. */
export const finalizeSourceLinkedReport = (report, { maxBytes, fail, message, check = null }) => {
  let nonempty = false;
  if (report && typeof report === 'object') for (const key in report) if (Object.hasOwn(report, key)) { nonempty = true; break; }
  if (!report || typeof report !== 'object' || Array.isArray(report) || !nonempty
    || Object.hasOwn(report, 'identity') || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024
    || typeof fail !== 'function' || typeof message !== 'string' || !message || check !== null && typeof check !== 'function') {
    throw new TypeError('An unsigned report and explicit producer byte/error contract are required.');
  }
  check?.();
  if (maxBytes <= identityEntryBytes) throw fail(message);
  let encoded;
  try { encoded = canonicalSemanticJson(report, { maxBytes: maxBytes - identityEntryBytes, check }); }
  catch (error) {
    const observation = observeStorageResource(error, { phase: 'source-linked-report-encoding' });
    observation.requireSettled();
    let code;
    try { code = error?.code; }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    if (code !== 'ERR_SEMANTIC_JSON_BUDGET') throw error;
    let mapped;
    try { mapped = fail(message); }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    throw addStorageFailureContext(mapped, {}, observation.retain(), { secondaryPresent: true });
  }
  const owned = JSON.parse(encoded);
  const result = { ...owned, identity: createHash('sha256').update('tooling.source-linked-evidence.v1\0', 'utf8')
    .update(encoded, 'utf8').digest('hex') };
  check?.();
  return result;
};
