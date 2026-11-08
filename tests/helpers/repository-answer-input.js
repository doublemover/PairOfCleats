import { createHash } from 'node:crypto';
import { CURRENT_READER_QUESTION_PROFILE, repositoryQuestionRowId } from '../../src/semantic/questions/current-reader-profile.js';
import { SEMANTIC_OPERATION_INDEX_VERSION } from '../../src/semantic/source-order.js';
import { ANSWER_EVIDENCE_VERSION } from '../../src/contracts/schemas/answer-evidence.js';
import { REPOSITORY_QUESTION_VERSION } from '../../src/contracts/schemas/repository-question.js';

/** Supplied model-only fixtures for the deterministic answer compiler. Live
 * admission/source authority is exercised by the separate integration owner. */
export const createRepositoryAnswerInput = ({ count = 2, partial = false, unresolved = 0, revision = 'build-1' } = {}) => {
  const partitionId = 'sy1:' + 'a'.repeat(64), ref = localId => ({ partitionId, localId });
  const source = span => ({ sourceUnitId: 'su1:' + 'b'.repeat(64), sourceHash: 'c'.repeat(64), path: 'src/handler.js', span, coordinateUnit: 'utf16' });
  const generation = { baseBuildId: revision, semanticRevision: 0 }, logicalPlanId = createHash('sha256').update(revision).digest('hex');
  const world = { repositoryNamespace: 'fixture-namespace', generation, sourceSnapshotId: createHash('sha256').update('inventory:' + revision).digest('hex'),
    contextKey: 'all-retained-provider-contexts-v1', domainId: 'selected-call-domain',
    producerId: CURRENT_READER_QUESTION_PROFILE + ':operation-index-' + SEMANTIC_OPERATION_INDEX_VERSION };
  const rows = Array.from({ length: count }, (_, index) => {
    const bindings = [{ variable: '$c', sort: 'Invocation', ref: ref(index * 3), source: source([index * 30, index * 30 + 10]), invocationKind: 'call' },
      { variable: '$d', sort: 'Declaration', ref: ref(index * 3 + 1), source: source([100 + index * 20, 110 + index * 20]), name: 'parseRequest' },
      { variable: '$a', sort: 'Literal', ref: ref(index * 3 + 2), source: source([index * 30 + 3, index * 30 + 4]), scalar: { type: 'number', representation: '0' } }];
    const fact = (member, offset) => ({ owner: bindings[0].ref, member, offset, rowHash: 'd'.repeat(64) });
    return { rowId: repositoryQuestionRowId(logicalPlanId, bindings.map(binding => binding.ref)), bindings,
      witnesses: [{ operatorId: 0, meaning: 'syntactic-zero-based-argument', fact: fact('semantic_operands', index) },
        { operatorId: 1, ref: bindings[2].ref }, { operatorId: 2, meaning: 'recorded-target-candidate', fact: fact('semantic_edges', index), contextKey: 'context', certainty: 'modeled' },
        { operatorId: 3, ref: bindings[1].ref }], detailRequest: { repoRoot: world.repositoryNamespace, generation, refs: bindings.map(binding => binding.ref) } };
  });
  const queryReceipt = { schemaVersion: REPOSITORY_QUESTION_VERSION, kind: 'repository-question-indexed-page', profile: CURRENT_READER_QUESTION_PROFILE, world,
    requestDigest: 'e'.repeat(64), logicalPlanId, physicalPlanId: 'f'.repeat(64), status: partial || unresolved ? 'partial' : 'complete-in-retained-input', rows,
    originMap: ['argument', 'zero', 'target', 'name'].map((clauseId, operatorId) => ({ operatorId, authored: [{ clauseId, path: ['where', 'all', operatorId] }] })),
    frontier: [], refutations: [], frontierOmitted: 0, refutationsOmitted: 0,
    completion: { enumeration: partial ? 'partial' : 'complete-in-retained-input', analysis: 'incomplete', programSemantics: 'not-established', rankedPrefix: 'not-established' },
    counts: { returnedRows: count, emittedThroughCursor: count, unresolvedThroughCursor: unresolved, totalInRetainedRelation: partial || unresolved ? null : count, programTotal: null },
    verification: 'retained-records-and-source-headers', supportSelection: 'one-deterministic-witness-per-row', diagnosticSelection: 'bounded-observed-clause-failures' };
  return { schemaVersion: ANSWER_EVIDENCE_VERSION, questionRef: { id: 'shutdown-question', revision: 'question-1' }, queryReceipt, quotations: [], openRequirements: [] };
};
export const answerQuotation = (text = 'A😀B') => ({ source: { sourceUnitId: 'su1:' + 'b'.repeat(64), sourceHash: 'c'.repeat(64),
  path: 'src/handler.js', span: [10, 10 + text.length], coordinateUnit: 'utf16' }, text,
contentHash: createHash('sha256').update(text, 'utf8').digest('hex') });
