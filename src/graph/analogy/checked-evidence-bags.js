import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { createOccurrenceRelation, openOccurrenceCursor } from '../../semantic/relations/factor.js';
import { OCCURRENCE_SUM_OBSERVATION, proposeOccurrenceSumNormalization,
  checkOccurrenceSumProof, executeOccurrenceSumRequest } from '../../index/semantic/equivalence/occurrence-sums.js';
import { throwIfAborted } from '../../shared/abort.js';

/** Motif adjacency observes an unranked bag of canonical edge witnesses. It
 * never observes factor-choice paths or source enumeration order. This explicit
 * consumer boundary permits only the existing checked bag sum alternative. */
export const composeCheckedSemanticEvidenceBags = ({ evidence, world, complete, signal = null }) => {
  throwIfAborted(signal);
  if (!Array.isArray(evidence) || evidence.length > 4096 || typeof complete !== 'boolean') {
    throw new TypeError('Bounded canonical semantic evidence bags required.');
  }
  if (!evidence.length) return { evidence: [], normalization: { status: 'empty-captured-bag', receiptId: null,
    observation: OCCURRENCE_SUM_OBSERVATION, ordering: 'not-observed' } };
  const groups = new Map(), byId = new Map();
  for (const entry of evidence) {
    const id = canonicalSemanticJson(entry.edge.from);
    if (byId.has(entry.id)) throw new TypeError('Repeated canonical edge identity requires an explicit occurrence adapter.');
    byId.set(entry.id, entry);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ occurrenceId: entry.id, supportId: entry.id, multiplicity: '1',
      tuple: [id, canonicalSemanticJson(entry.edge.to), entry.edge.kind, entry.id], sourceRef: entry.edge.from });
  }
  const inputs = new Map([...groups].map(([id, rows]) => [id, createOccurrenceRelation({ world,
    relationId: 'motif-incident:' + id, atomRoleId: 'retained-semantic-edge',
    schema: ['from', 'to', 'kind', 'evidenceId'].map(name => ({ name, type: 'string', nullable: false })),
    rows, complete, maxRetainedBytes: 4 * 1024 * 1024 })]));
  const proposal = proposeOccurrenceSumNormalization({ inputs, world, observation: OCCURRENCE_SUM_OBSERVATION,
    term: { op: 'sum', children: [...inputs.keys()].map(input => ({ op: 'input', input })) } });
  const check = checkOccurrenceSumProof({ ...proposal, maxWork: 4096, signal });
  throwIfAborted(signal);
  const executed = executeOccurrenceSumRequest({ request: proposal.request,
    ...(check.status === 'checked-in-model' ? { receipt: check.receipt } : {}) });
  const cursor = openOccurrenceCursor({ relation: executed.relation }), result = [];
  try {
    while (true) {
      throwIfAborted(signal);
      const page = cursor.next({ limit: 128, workBudget: 32768, maxBytes: 65536, signal });
      for (const row of page.items) {
        const entry = byId.get(row.tuple.evidenceId);
        if (!entry || row.tuple.from !== canonicalSemanticJson(entry.edge.from)
          || row.tuple.to !== canonicalSemanticJson(entry.edge.to) || row.tuple.kind !== entry.edge.kind
          || row.occurrences.length !== 1 || row.occurrences[0].occurrenceId !== entry.id
          || row.occurrences[0].supportId !== entry.id || row.occurrences[0].copyOrdinal !== '0') {
          throw new TypeError('Checked motif bag differs from its original canonical occurrences.');
        }
        result.push(entry);
      }
      if (page.state === 'exhausted') break;
      if (!page.items.length) throw new RangeError('Motif occurrence row exceeds its bounded composition allowance.');
    }
  } finally { cursor.close(); }
  if (result.length !== evidence.length) throw new TypeError('Checked motif bag lost original occurrence multiplicity.');
  return { evidence: result, normalization: { status: check.status, receiptId: check.receipt?.receiptId || null,
    observation: OCCURRENCE_SUM_OBSERVATION, plan: executed.plan, ordering: 'not-observed',
    physicalChoicePaths: 'not-equated', semanticClosure: 'not-implied' } };
};
