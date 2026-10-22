import { readSourceLinkedEvidenceDetail } from './source-linked-evidence-detail.js';
import { readLspObservationDetail } from './lsp-observation-detail.js';
import { throwIfAborted } from '../shared/abort.js';

const sourceLinkedKinds = new Set(['graphql-schema-references', 'configuration-local-references', 'template-local-references',
  'proto-descriptor-references', 'shellcheck-diagnostics', 'sql-catalog-references', 'scala-semanticdb-references', 'astro-generated-references']);
const budgetError = () => Object.assign(new Error('Provider evidence exceeds the shared semantic page allowance.'), { code: 'ERR_SEMANTIC_EVIDENCE_BUDGET' });
const bounded = (value, size = 256) => String(value ?? '').slice(0, size);

export const providerEvidenceState = (ref, record, reason, state = 'unavailable') => ({ evidenceRef: ref,
  producerId: bounded(record?.data?.producerId || 'unavailable'), method: bounded(record?.data?.method || 'unavailable'),
  evidenceKind: bounded(record?.data?.evidenceKind || 'unavailable'), sourceUnitId: record?.data?.sourceRef || null,
  sourceHash: null, kind: 'state', qualification: 'unavailable', state, reason });

/** One compact retained entry per evidence step. The public detail cursor owns
 * the offset and page allowance, so no second raw-input, row or deadline budget
 * is created here. Every observed source/target is read from the pinned store. */
export const readProviderEvidenceEntry = async ({ store, ref, record, offset, budget, signal }) => {
  throwIfAborted(signal);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 16384) throw new TypeError('Invalid provider evidence offset.');
  const kind = record.data.evidenceKind;
  if (store.backend !== 'artifact' || (!sourceLinkedKinds.has(kind) && kind !== 'lsp-structured-observation')) return {
    entry: providerEvidenceState(ref, record, store.backend !== 'artifact' ? 'retained_artifact_backend_unavailable' : 'unsupported_provider_evidence_kind'), done: true
  };
  const verified = new Set();
  const scopedStore = { ...store,
    async getRecords(...args) {
      budget.consumeRows(args[0].length);
      return store.getRecords(...args);
    },
    async *iterateRows(...args) {
      for await (const row of store.iterateRows(...args)) { budget.consumeRows(1); yield row; }
    },
    async verifySource(source, options) {
      if (!verified.has(source.sourceUnitId)) {
        budget.consumeBytes(source.byteLength);
        await store.verifySource(source, options);
        verified.add(source.sourceUnitId);
      }
    }
  };
  const options = { store: scopedStore, ref, signal, budget, maxBytes: Math.max(1, budget.remainingBytes()) };
  const base = { ...providerEvidenceState(ref, record, ''), sourceHash: null, state: 'partial' };
  delete base.reason;
  if (sourceLinkedKinds.has(kind)) {
    const detail = await readSourceLinkedEvidenceDetail({ ...options, maxReferences: 1,
      referenceOffset: Math.min(4096, offset), targetStoreForSource: () => scopedStore });
    const { result, source } = detail;
    Object.assign(base, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, qualification: 'source-qualified-observation' });
    const reference = result.references[offset];
    if (reference) {
      budget.consumeRows(1);
      const target = detail.navigationCandidates[0] || null;
      return { entry: { ...base, kind: 'reference', name: bounded(reference.name), family: bounded(reference.family),
        span: reference.span, target: target ? { path: target.path, sourceUnitId: target.sourceUnitId,
          sourceHash: target.sourceHash, span: target.span } : null,
        state: target ? 'partial' : 'unresolved', reason: target ? 'qualified_observation_not_complete_binding'
          : bounded(detail.unresolvedTargets[0]?.reason || reference.reason || 'unresolved_observation'),
        candidateCount: Math.min(4096, Array.isArray(reference.candidates) ? reference.candidates.length : target ? 1 : 0) },
      done: offset + 1 >= result.references.length + result.diagnostics.length };
    }
    const diagnostic = result.diagnostics[offset - result.references.length];
    if (diagnostic) {
      budget.consumeRows(1);
      return { entry: { ...base, kind: 'diagnostic', span: diagnostic.span || null,
        diagnostic: { code: bounded(diagnostic.code || 'provider_diagnostic'), message: bounded(diagnostic.message, 1024),
          severity: bounded(diagnostic.severity || diagnostic.level || 'unknown', 32), truncated: String(diagnostic.message || '').length > 1024 } },
      done: offset + 1 >= result.references.length + result.diagnostics.length };
    }
    return { entry: { ...base, kind: 'state', reason: bounded(result.reason || 'no_retained_observations') }, done: true };
  }
  const detail = await readLspObservationDetail(options), fact = detail.observation.facts[offset];
  Object.assign(base, { sourceUnitId: detail.sourceUnitId, sourceHash: detail.sourceHash, qualification: 'provider-observation' });
  if (!fact) return { entry: { ...base, kind: 'state', reason: bounded(detail.observation.reason || 'no_retained_observations') }, done: true };
  budget.consumeRows(1);
  // Captured exact LSP coordinates are still provider evidence. This reader has
  // not independently joined a foreign target to a published syntax partition.
  return { entry: { ...base, kind: 'observation', name: bounded(fact.name), family: bounded(fact.kind),
    observedTarget: fact.target ? { sourceUnitId: fact.target.sourceUnitId || null, sourceHash: fact.target.sourceHash || null,
      span: fact.target.span || null, state: bounded(fact.target.state || 'unmapped') } : null,
    reason: 'captured_protocol_observation_not_complete_binding' }, done: offset + 1 >= detail.observation.facts.length };
};

export const createProviderEvidenceBudget = ({ remainingBytes, remainingRows, chargeBytes, chargeRows }) => ({
  remainingBytes,
  consumeBytes(count) { if (!Number.isSafeInteger(count) || count < 0 || count > remainingBytes()) throw budgetError(); chargeBytes(count); },
  consumeRows(count) { if (!Number.isSafeInteger(count) || count < 0 || count > remainingRows()) throw budgetError(); chargeRows(count); }
});
