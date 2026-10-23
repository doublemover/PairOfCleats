import path from 'node:path';
import { canonicalSemanticJson, semanticHash } from './identity.js';
import { COMPILER_SUMMARY_MANIFEST_VERSION, COMPILER_SUMMARY_MANIFEST_MAX_BYTES } from './compiler-summary-manifest.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';
import { throwIfAborted } from '../../shared/abort.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const array = value => Array.isArray(value) && value.length <= 4096;
const reference = value => {
  if (typeof value !== 'string' || value.length > 256) return false;
  let ref; try { ref = JSON.parse(value); } catch { return false; }
  return exact(ref, ['partitionId', 'localId']) && /^(?:sy1|sa1):[a-f0-9]{64}$/u.test(ref.partitionId)
    && Number.isSafeInteger(ref.localId) && ref.localId >= 0 && canonicalSemanticJson(ref) === value;
};
const unique = (values, project = value => value) => {
  const seen = new Set();
  for (const value of values) {
    let key; try { key = project(value); } catch { return false; }
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};
const refs = values => array(values) && values.every(reference) && unique(values);
const decision = (reason, fields = {}) => Object.freeze({ schemaVersion: 1, status: reason ? 'rebuild-required' : 'shadow-compatible',
  qualifiesReuse: false, reason, blockers: Object.freeze(reason ? [reason] : [
    'information_dependency_completeness_unqualified', 'cross_generation_locator_migration_unqualified',
    'summary_reuse_publication_unimplemented'
  ]), ...fields });
const validSpan = value => Array.isArray(value) && value.length === 2
  && value.every(offset => Number.isSafeInteger(offset) && offset >= 0) && value[0] <= value[1];
const propertyKey = value => value === null || typeof value === 'string'
  || exact(value, ['private', 'source', 'owner']) && typeof value.private === 'string' && value.private.startsWith('#')
    && typeof value.source === 'string' && value.source.length > 0 && Number.isSafeInteger(value.owner) && value.owner >= 0;
const validSourceIdentity = (value, summary) => {
  if (value === null) return true;
  if (value?.status === 'unavailable') return exact(value, ['status', 'reason']) && typeof value.reason === 'string';
  if (!exact(value, ['status', 'reason', 'sourceUnitId', 'sourceHash', 'span', 'bodySpan', 'bodyHash', 'headerHash', 'locator', 'locatorHash'])
    || !['qualified-for-comparison', 'ambiguous', 'body-only'].includes(value.status)
    || !(value.reason === null || typeof value.reason === 'string')
    || value.sourceUnitId !== summary.localInputs.sourceUnitId || value.sourceHash !== summary.localInputs.sourceHash
    || !validSpan(value.span) || !validSpan(value.bodySpan) || value.bodySpan[0] < value.span[0] || value.bodySpan[1] !== value.span[1]
    || canonicalSemanticJson(value.span) !== canonicalSemanticJson(summary.locator.span)
    || !hash(value.bodyHash) || !hash(value.headerHash)) return false;
  if (value.status === 'body-only') return value.locator === null && value.locatorHash === null;
  return exact(value.locator, ['path', 'language', 'mappingIdentity', 'lexical', 'headerHash'])
    && value.locator.path === summary.locator.path && typeof value.locator.language === 'string'
    && (value.locator.mappingIdentity === null || hash(value.locator.mappingIdentity))
    && Array.isArray(value.locator.lexical) && value.locator.lexical.length > 0 && value.locator.lexical.length <= 64
    && value.locator.lexical.every(row => exact(row, ['kind', 'name']) && typeof row.kind === 'string'
      && typeof row.name === 'string' && row.name.length > 0 && row.name.length <= 256)
    && value.locator.headerHash === value.headerHash
    && value.locatorHash === semanticHash('semantic.summary-locator.v1', value.locator);
};
const validSummary = summary => {
  if (!exact(summary, ['declaration', 'locator', 'localInputs', 'payload', 'reads', 'callees', 'contributions', 'supports', 'payloadHash', 'supportHash', 'identityHash'])
    || !reference(summary.declaration) || !exact(summary.locator, ['path', 'span', 'sourceIdentity'])
    || typeof summary.locator.path !== 'string' || !exact(summary.localInputs,
    ['sourceUnitId', 'sourceHash', 'flowPartitionId', 'flowHash', 'policyHash', 'dependencyIdentityHash'])
    || !/^su1:[a-f0-9]{64}$/u.test(summary.localInputs.sourceUnitId)
    || !/^sa1:[a-f0-9]{64}$/u.test(summary.localInputs.flowPartitionId)
    || !['sourceHash', 'flowHash', 'policyHash', 'dependencyIdentityHash'].every(key => hash(summary.localInputs[key]))
    || !validSpan(summary.locator.span) || !validSourceIdentity(summary.locator.sourceIdentity, summary)) return false;
  const payload = summary.payload;
  if (!exact(payload, ['parameters', 'returns', 'exceptions', 'dependencies', 'exceptionDependencies', 'effects',
    'complete', 'converged', 'widened', 'async', 'generator', 'constructible', 'restIndex'])
    || !array(payload.parameters) || !payload.parameters.every(ref => ref === null || reference(ref))
    || !refs(payload.returns) || !refs(payload.exceptions)
    || !['complete', 'converged', 'widened', 'async', 'generator', 'constructible'].every(key => typeof payload[key] === 'boolean')
    || !Number.isSafeInteger(payload.restIndex) || payload.restIndex < -1 || payload.restIndex >= payload.parameters.length) return false;
  const ordinals = values => array(values) && unique(values)
    && values.every(value => Number.isSafeInteger(value) && value >= -1 && value < payload.parameters.length);
  if (!ordinals(payload.dependencies) || !ordinals(payload.exceptionDependencies) || !array(payload.effects)
    || payload.effects.some(effect => !exact(effect, ['parameter', 'path', 'refs', 'dependencies'])
      || !Number.isSafeInteger(effect.parameter) || effect.parameter < -1 || effect.parameter >= payload.parameters.length
      || !array(effect.path) || !effect.path.every(propertyKey)
      || !refs(effect.refs) || !ordinals(effect.dependencies))) return false;
  const structure = array(summary.reads) && unique(summary.reads, row => row.ref)
    && summary.reads.every(row => exact(row, ['ref', 'predecessors']) && reference(row.ref) && refs(row.predecessors))
    && array(summary.callees) && unique(summary.callees, row => row.ref)
    && summary.callees.every(row => exact(row, ['ref', 'status']) && reference(row.ref) && ['available', 'missing'].includes(row.status))
    && array(summary.contributions) && unique(summary.contributions, canonicalSemanticJson)
    && summary.contributions.every(row => exact(row, ['callSite', 'from', 'to', 'callee'])
      && [row.callSite, row.from, row.to].every(reference) && (row.callee === null || reference(row.callee)))
    && array(summary.supports) && unique(summary.supports, canonicalSemanticJson)
    && summary.supports.every(row => exact(row, ['channel', 'input', 'callSite', 'callee'])
      && (row.channel === 'return' || row.channel === 'exception' || typeof row.channel === 'string' && row.channel.startsWith('effect:'))
      && Number.isSafeInteger(row.input) && row.input >= -1 && row.input < payload.parameters.length
      && [row.callSite, row.callee].every(ref => ref === null || reference(ref)));
  return structure && summary.payloadHash === semanticHash('semantic.summary-payload.v2', payload)
    && summary.supportHash === semanticHash('semantic.summary-support.v2', { reads: summary.reads, callees: summary.callees,
      contributions: summary.contributions, supports: summary.supports })
    && summary.identityHash === semanticHash('semantic.summary-generation.v2', { declaration: summary.declaration,
      localInputs: summary.localInputs, locator: summary.locator, payloadHash: summary.payloadHash, supportHash: summary.supportHash });
};

/** Schema/identity compatibility admits inspection only. Even a checksum-valid
 * completed shadow payload never authorizes reuse or an affected-SCC shortcut.
 */
export const admitCompilerSummaryManifest = ({ manifest, expectedIdentity, signal = null }) => {
  throwIfAborted(signal);
  let encoded, value;
  try {
    encoded = canonicalSemanticJson(manifest, { maxBytes: COMPILER_SUMMARY_MANIFEST_MAX_BYTES, check: () => throwIfAborted(signal) });
    value = JSON.parse(encoded);
  } catch (error) {
    describeStorageFailure(error, { phase: 'compiler-summary-admission' }); throwIfAborted(signal);
    return decision('summary_manifest_malformed_or_over_budget');
  }
  if (value?.schemaVersion !== COMPILER_SUMMARY_MANIFEST_VERSION || value.mode !== 'shadow'
    || value.qualifiesReuse !== false || value.reuseGuard !== 'full-group-rebuild-required'
    || value.domain !== 'finite-parameter-return-exception-field-may-v1') return decision('summary_manifest_version_or_domain_mismatch');
  if (value.status === 'unavailable') return decision('summary_manifest_recording_unavailable');
  if (!exact(value, ['schemaVersion', 'domain', 'mode', 'qualifiesReuse', 'reuseGuard', 'status', 'reason', 'identity',
    'limits', 'converged', 'ownershipReasons', 'analysisReasons', 'summaries']) || value.status !== 'recorded' || value.reason !== null
    || !exact(value.limits, ['maxBytes', 'maxEntries']) || !Number.isSafeInteger(value.limits.maxBytes)
    || value.limits.maxBytes < 1024 || value.limits.maxBytes > COMPILER_SUMMARY_MANIFEST_MAX_BYTES
    || !Number.isSafeInteger(value.limits.maxEntries) || value.limits.maxEntries < 1 || value.limits.maxEntries > 4096
    || typeof value.converged !== 'boolean' || !array(value.ownershipReasons) || !value.ownershipReasons.every(reason => typeof reason === 'string')
    || !array(value.analysisReasons) || !value.analysisReasons.every(reason => typeof reason === 'string')
    || !array(value.summaries) || !unique(value.summaries, summary => summary.declaration) || !value.summaries.every(validSummary)) {
    return decision('summary_manifest_schema_mismatch');
  }
  if (Buffer.byteLength(encoded) > value.limits.maxBytes || value.summaries.length > value.limits.maxEntries
    || value.converged && (value.analysisReasons.length || value.summaries.some(summary => !summary.payload.converged))) {
    return decision('summary_manifest_recorded_limits_or_convergence_mismatch');
  }
  const expected = canonicalSemanticJson(expectedIdentity, { maxBytes: COMPILER_SUMMARY_MANIFEST_MAX_BYTES, check: () => throwIfAborted(signal) });
  if (canonicalSemanticJson(value.identity) !== expected) return decision('summary_manifest_broad_identity_changed');
  const identityHash = semanticHash('semantic.summary-shadow-identity.v1', value.identity);
  if (value.summaries.some(summary => summary.localInputs.dependencyIdentityHash !== identityHash)) return decision('summary_manifest_dependency_identity_mismatch');
  return decision(null, { identityHash,
    manifestHash: semanticHash('semantic.summary-shadow-admission.v1', value), summaryCount: value.summaries.length,
    converged: value.converged });
};

/** Read only a registered hash-qualified sidecar through the original contained
 * descriptor owner. There is no current-working-tree or arbitrary-path fallback.
 */
export const readPersistedCompilerSummaryManifest = async ({ root, descriptor, registeredInventory, expectedIdentity, signal = null }) => {
  throwIfAborted(signal);
  try {
    const captured = JSON.parse(canonicalSemanticJson({ root, descriptor, registeredInventory, expectedIdentity }, {
      maxBytes: COMPILER_SUMMARY_MANIFEST_MAX_BYTES, check: () => throwIfAborted(signal)
    }));
    ({ root, descriptor, registeredInventory, expectedIdentity } = captured);
  } catch (error) {
    describeStorageFailure(error, { phase: 'compiler-summary-admission-input' }); throwIfAborted(signal);
    return { manifest: null, admission: decision('summary_manifest_request_malformed_or_over_budget') };
  }
  if (!exact(descriptor, ['path', 'hash', 'bytes']) || !hash(descriptor.hash)
    || descriptor.path !== 'semantic-evidence/' + descriptor.hash + '.json'
    || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > COMPILER_SUMMARY_MANIFEST_MAX_BYTES
    || !array(registeredInventory) || !registeredInventory.some(row => canonicalSemanticJson(row, { maxBytes: 4096 })
      === canonicalSemanticJson(descriptor))) return { manifest: null, admission: decision('summary_manifest_not_registered') };
  try {
    const { buffer } = await readVerifiedContainedFile(root, path.join(root, descriptor.path), {
      maxBytes: descriptor.bytes, expectedHash: descriptor.hash, signal
    });
    if (buffer.length !== descriptor.bytes) return { manifest: null, admission: decision('summary_manifest_size_mismatch') };
    const encoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer), manifest = JSON.parse(encoded);
    if (canonicalSemanticJson(manifest, { maxBytes: descriptor.bytes }) !== encoded) {
      return { manifest: null, admission: decision('summary_manifest_noncanonical') };
    }
    const admission = admitCompilerSummaryManifest({ manifest, expectedIdentity, signal });
    if (admission.status === 'shadow-compatible') {
      const work = [manifest];
      while (work.length) { const value = work.pop(); if (value && typeof value === 'object') { work.push(...Object.values(value)); Object.freeze(value); } }
    }
    return { manifest: admission.status === 'shadow-compatible' ? manifest : null, admission };
  } catch (error) {
    const failure = describeStorageFailure(error, { phase: 'compiler-summary-persisted-admission' }); throwIfAborted(signal);
    return { manifest: null, admission: decision('summary_manifest_read_or_integrity_failure', { failureCode: failure.code }) };
  }
};
