import { semanticHash, canonicalSemanticJson } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../abort.js';
import { inspectEvidenceTaskJudgments, readEvidenceTaskJudgments } from '../../retrieval/evaluation/tasks/judgments.js';

const owned = new WeakMap();
const fail = message => Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_ADAPTATION_COHORT' });
const hash = (kind, value) => semanticHash('retrieval-adaptation.cohort.' + kind + '.v1', value, { maxBytes: 8 * 1024 * 1024 });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};

/** Consume only original training members after the task owner's split audit.
 * No mining, model, hidden held-out inputs or implicit in-batch negatives.
 */
export const compileRetrievalTrainingCohort = (judgmentSets, { signal = null } = {}) => {
  throwIfAborted(signal);
  if (!Array.isArray(judgmentSets) || !judgmentSets.length || judgmentSets.length > 32 || new Set(judgmentSets).size !== judgmentSets.length) throw fail('One to 32 original judgment sets required.');
  // Inspect all memberships before reading any labels/text. Held-out annotation
  // owners cannot enter a training corpus through another candidate's queue.
  const reports = judgmentSets.map(inspectEvidenceTaskJudgments);
  if (reports.some(row => row.split !== 'train') || new Set(reports.map(row => row.splitManifestId)).size !== 1
    || new Set(reports.map(row => row.compilationId)).size !== reports.length) throw fail('Distinct original training tasks from one frozen split manifest required.');
  const documents = new Map(), rows = [], dependencies = new Set(); let sourceBytes = 0;
  for (const handle of judgmentSets) {
    throwIfAborted(signal);
    const content = readEvidenceTaskJudgments(handle), report = inspectEvidenceTaskJudgments(handle);
    const parent = new Map(content.documents.map(doc => [doc.documentId, doc.documentId]));
    const root = id => { let at = id; while (parent.get(at) !== at) at = parent.get(at); return at; };
    for (const alias of content.aliases) parent.set(root(alias.documentIds[1]), root(alias.documentIds[0]));
    const protectedGroups = new Set(content.protectedDocuments.map(root));
    for (const row of content.judgments) if (row.label === 'positive') protectedGroups.add(root(row.documentId));
    const byDocument = new Map();
    for (const annotation of content.judgments) {
      if (!byDocument.has(annotation.documentId)) byDocument.set(annotation.documentId, []);
      byDocument.get(annotation.documentId).push(annotation);
    }
    const pairs = content.documents.map(doc => {
      if (!documents.has(doc.documentId)) {
        sourceBytes += Buffer.byteLength(doc.text); if (sourceBytes > 8 * 1024 * 1024) throw fail('Training corpus exceeds its explicit 8 MiB source allowance.');
        documents.set(doc.documentId, doc);
      }
      dependencies.add(doc.source.sourceHash);
      const annotations = byDocument.get(doc.documentId) ?? [], labels = new Set(annotations.map(row => row.label));
      const conflict = labels.size > 1 || labels.has('verified-negative') && protectedGroups.has(root(doc.documentId));
      const label = conflict ? 'conflict' : labels.size ? [...labels][0] : 'unknown';
      const admitted = ['positive', 'verified-negative'].includes(label);
      return { documentId: doc.documentId, label, mask: admitted && annotations.every(row => row.weight > 0) ? 1 : 0,
        grade: label === 'positive' ? Math.min(...annotations.map(row => row.grade)) : 0,
        weight: admitted ? Math.min(...annotations.map(row => row.weight)) : 0,
        reason: conflict ? 'contradictory-or-protected-positive-annotations' : annotations.length ? 'explicit-task-annotation' : 'unlabeled-alias',
        annotations,
        annotationIds: annotations.map(annotation => hash('annotation', annotation)).sort(order) };
    }).sort((a, b) => order(a.documentId, b.documentId));
    const queryId = hash('query', { compilationId: content.compilationId, requirementId: content.requirementId, rawQueryHash: content.rawQueryHash });
    rows.push({ queryId, publicTaskId: content.publicTaskId, compilationId: content.compilationId, judgmentSetId: report.judgmentSetId,
      requirementId: content.requirementId, query: content.query, rawQueryHash: content.rawQueryHash, normalizedQueryHash: content.normalizedQueryHash,
      normalization: content.normalization, world: content.world, groupId: content.groupId, rightsScopeId: content.rightsScopeId,
      provenance: { producerId: content.producerId, assumptionsId: content.assumptionsId, reviewReceiptIds: content.reviewReceiptIds,
        aliases: content.aliases, protectedDocuments: content.protectedDocuments },
      labelCoverage: content.labelCoverage, pairs, eligible: pairs.some(row => row.mask && row.label === 'positive')
        && pairs.some(row => row.mask && row.label === 'verified-negative') });
  }
  rows.sort((a, b) => order(a.queryId, b.queryId));
  const content = immutable({ schemaVersion: 1, kind: 'source-pinned-retrieval-training-cohort', split: 'train',
    splitManifestId: reports[0].splitManifestId, rows, documents: [...documents.values()].sort((a, b) => order(a.documentId, b.documentId)),
    sourceDependencies: [...dependencies].sort(order),
    authority: 'explicit-authored-task-annotations; no-independent-semantic-proof', nearDuplicateAudit: 'inherited-unchecked',
    unknownPolicy: 'mask-zero; other-query-documents-never-implicit-negatives' });
  canonicalSemanticJson(content, { maxBytes: 8 * 1024 * 1024 });
  const cohortId = hash('content', content), pairs = rows.flatMap(row => row.pairs);
  const result = immutable({ ...content, cohortId, coverage: { queries: rows.length, eligibleQueries: rows.filter(row => row.eligible).length,
    skippedWithoutPositiveOrNegative: rows.filter(row => !row.eligible).length, sourceSpans: documents.size, sourceBytes,
    positivePairs: pairs.filter(row => row.mask && row.label === 'positive').length,
    negativePairs: pairs.filter(row => row.mask && row.label === 'verified-negative').length,
    unknownPairs: pairs.filter(row => row.label === 'unknown').length, conflictPairs: pairs.filter(row => row.label === 'conflict').length,
    zeroMaskedPairs: pairs.filter(row => !row.mask).length } });
  owned.set(result, { queryMap: new Map(rows.map(row => [row.queryId, new Map(row.pairs.map(pair => [pair.documentId, pair]))])),
    documentIds: new Set(documents.keys()) });
  throwIfAborted(signal); return result;
};
export const inspectRetrievalTrainingCohort = cohort => {
  if (!cohort || !owned.has(cohort)) throw fail('Original compiled retrieval training cohort required.');
  if (owned.get(cohort).invalidation) throw fail('Retracted training inputs require a new clean cohort and training run.'); return cohort;
};
export const invalidateRetrievalTrainingCohort = (cohort, { kind, dependencyId }) => {
  const state = cohort && typeof cohort === 'object' ? owned.get(cohort) : null;
  if (!state || !['source-retracted', 'judgment-retracted'].includes(kind)
    || !(kind === 'source-retracted' ? cohort.sourceDependencies.includes(dependencyId)
      : cohort.rows.some(row => row.judgmentSetId === dependencyId))) throw fail('An original cohort and exact retracted source/judgment dependency required.');
  if (!state.invalidation) state.invalidation = immutable({ cohortId: cohort.cohortId, kind, dependencyId,
    state: 'invalidated', recovery: 'clean-cohort-and-retrain', exportedArtifactRevocation: 'external-qualification-registry-required' });
  return state.invalidation;
};

/** The only batch/queue mask owner. Candidate support changes no annotations.
 * Stable sorted unique IDs prevent duplicate documents receiving extra mass.
 */
export const retrievalTrainingMask = (cohort, queryId, documentIds) => {
  inspectRetrievalTrainingCohort(cohort); const state = owned.get(cohort), query = state.queryMap.get(queryId);
  if (!query || !Array.isArray(documentIds) || documentIds.length > 1024 || documentIds.some(id => !state.documentIds.has(id))) throw fail('Known query and bounded cohort document support required.');
  return immutable([...new Set(documentIds)].sort(order).map(documentId => {
    const pair = query.get(documentId);
    return pair ?? { documentId, label: 'unknown', mask: 0, grade: 0, weight: 0,
      reason: 'no-query-specific-annotation', annotations: [], annotationIds: [] };
  }));
};
