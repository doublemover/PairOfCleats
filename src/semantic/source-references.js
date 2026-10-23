import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { throwIfAborted } from '../shared/abort.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';
import { captureSemanticRecordRef } from './reader-input.js';

const integrity = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_INTEGRITY' });

/** Project retained source headers only. No worktree reads or generated-source
 * mapping are inferred here. The store owns generation and partition admission.
 */
export const createSourceReferenceReader = ({ sourceUnitForPartition, iterateRows }) => async (record, { signal = null } = {}) => {
  throwIfAborted(signal);
  if (!record || typeof record !== 'object') throw integrity('Invalid source reference record.');
  const spanProperty = Object.getOwnPropertyDescriptor(record, 'span');
  if (spanProperty && !Object.hasOwn(spanProperty, 'value')) throw integrity('Source reference span must be an own data value.');
  const inputSpan = spanProperty?.value;
  if (inputSpan == null) return null;
  if (!Array.isArray(inputSpan) || Object.getOwnPropertyDescriptor(inputSpan, 'length')?.value !== 2) {
    throw integrity('Invalid source reference span.');
  }
  const span = [];
  for (let index = 0; index < 2; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(inputSpan, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) {
      throw integrity('Invalid source reference span.');
    }
    span.push(descriptor.value);
  }
  if (span[1] < span[0]) throw integrity('Invalid source reference span.');
  const refProperty = Object.getOwnPropertyDescriptor(record, 'ref');
  if (!refProperty || !Object.hasOwn(refProperty, 'value')) throw integrity('Source reference RecordRef must be an own data value.');
  const ref = captureSemanticRecordRef(refProperty.value, integrity);
  const sourceUnitId = sourceUnitForPartition(ref.partitionId);
  if (!sourceUnitId) throw integrity('Source reference partition is outside the pinned inventory.');
  let source = null;
  for await (const row of iterateRows(ref.partitionId, 'semantic_sources', { signal, batchRows: 1 })) {
    if (source) throw integrity('Source reference has multiple retained source headers.');
    source = assertSemanticEnvelope('source', row);
  }
  if (!source || source.sourceUnitId !== sourceUnitId) throw integrity('Source reference header disagrees with its partition.');
  const coordinateLength = source.coordinateUnit === 'byte' ? source.byteLength : source.textLength;
  if (span[1] > coordinateLength) {
    throw integrity('Source reference span exceeds retained source coordinates.');
  }
  // Mapped source needs its own qualified coordinate adapter. Returning its
  // path as an ordinary source path would give an incorrect editor selection.
  if (source.mapping !== null) return null;
  return { ref, sourceUnitId, sourceHash: source.byteHash,
    path: source.path, coordinateUnit: source.coordinateUnit };
};

/** Optional source navigation evidence shares the existing page's byte/work
 * allowance. Missing metadata does not invent a mapping or change cursor facts.
 */
export const attachSemanticSourceReferences = async ({ store, result, signal, began, limits }) => {
  result.sourceRefs = [];
  const records = result.records.filter(record => record.span);
  if (!records.length) return;
  let incomplete = false;
  if (typeof store.getSourceReference !== 'function') incomplete = true;
  else {
    const seen = new Set();
    const remaining = limits.workMs - (performance.now() - began);
    const deadline = remaining > 0 ? AbortSignal.timeout(Math.max(1, Math.ceil(remaining))) : null;
    const scopedSignal = deadline ? signal ? AbortSignal.any([signal, deadline]) : deadline : signal;
    for (const record of records) {
      throwIfAborted(signal);
      if (!deadline || deadline.aborted || performance.now() - began >= limits.workMs) { incomplete = true; break; }
      const key = canonicalSemanticJson(record.ref);
      if (seen.has(key)) continue;
      let source;
      try { source = await store.getSourceReference(record, { signal: scopedSignal }); }
      catch (error) {
        const observation = observeStorageResource(error, { phase: 'semantic-source-reference' });
        observation.requireSettled();
        throwIfAborted(signal);
        let name;
        try { name = error?.name; }
        catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
        observation.requireSettled();
        if (!deadline.aborted || !(error === deadline.reason || ['AbortError', 'TimeoutError'].includes(name))) throw error;
        incomplete = true;
        break;
      }
      if (!source) { incomplete = true; continue; }
      if (canonicalSemanticJson(source.ref) !== key) throw integrity('Source reference belongs to another returned record.');
      result.sourceRefs.push(source);
      if (Buffer.byteLength(JSON.stringify(result)) + 256 > limits.bytes) {
        result.sourceRefs.pop(); incomplete = true; break;
      }
      seen.add(key);
    }
  }
  if (incomplete) {
    const warning = 'Some exact source mappings are unavailable or exceeded this page allowance; request detail for one record.';
    result.warnings.push(warning);
    if (Buffer.byteLength(JSON.stringify(result)) > limits.bytes) result.warnings.pop();
  }
  // The existing service owns the final response assertion/size check.
};
