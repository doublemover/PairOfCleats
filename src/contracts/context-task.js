import { createHash } from 'node:crypto';

export const isContextTaskFailure = error => ['ERR_CONTEXT_PACK_UNIT_UNAVAILABLE', 'ERR_CONTEXT_PACK_UNIT_CANNOT_FIT',
  'ERR_CONTEXT_PACK_UNIT_DEADLINE', 'ERR_CONTEXT_PACK_SOURCE_MISMATCH'].includes(error?.code);

/** Schema admits only complete file units; these facts tie the actual excerpt,
 * source evidence and selected index identity to that declaration.
 */
export const contextTaskProjectionErrors = payload => {
  const policy = payload.evidence?.policy?.taskPolicy;
  if (policy?.task !== 'edit-safe') return payload.primary?.unit ? ['An edit unit requires an explicit edit-safe task policy.'] : [];
  const primary = payload.primary, unit = primary?.unit, evidence = payload.evidence?.primary;
  if (!unit || !evidence) return ['Edit-safe primary requires an intact unit and source evidence.'];
  const errors = [], algorithm = unit.sourceHash.startsWith('sha256:') ? 'sha256' : 'sha1';
  const actualHash = algorithm + ':' + createHash(algorithm).update(primary.excerpt, 'utf8').digest('hex');
  if (actualHash !== unit.sourceHash || unit.byteLength !== Buffer.byteLength(primary.excerpt)
    || unit.span[0] !== 0 || unit.span[1] !== primary.excerpt.length
    || unit.indexSignature !== payload.provenance?.indexSignature
    || unit.requestedGranularity !== policy.granularity || unit.fallbackUsed !== (policy.granularity === 'function')
    || unit.fallbackUsed && !policy.wholeFileFallback) errors.push('Edit unit differs from its complete source, index identity or requested granularity.');
  for (const source of [primary.evidence, evidence]) {
    if (!source?.fileBacked || source.missing || source.substituted || source.truncated || source.truncatedBytes || source.truncatedTokens
      || source.source !== 'indexed-source-verified' || source.sourceIdentity?.drift !== 'unchanged'
      || source.sourceIdentity?.currentHash !== unit.sourceHash || source.sourceIdentity?.indexedHash !== unit.sourceHash) {
      errors.push('Edit-safe evidence cannot claim missing, substituted, clipped or changed source.');
    }
  }
  return errors;
};
