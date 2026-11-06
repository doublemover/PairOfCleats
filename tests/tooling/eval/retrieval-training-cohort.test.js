import assert from 'node:assert/strict';
import { retrievalTrainingFixture } from '../../helpers/retrieval-training-cohort.js';
import { evidenceTaskHash as hash } from '../../helpers/finite-evidence-task.js';
import { compileEvidenceTaskJudgments, inspectEvidenceTaskJudgments } from '../../../src/retrieval/evaluation/tasks/judgments.js';
import { disposeEvidenceTask } from '../../../src/retrieval/evaluation/tasks/compiler.js';
import { compileRetrievalTrainingCohort, retrievalTrainingMask, inspectRetrievalTrainingCohort } from '../../../src/shared/retrieval-adaptation/cohort.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/retrieval-training-cohort/')[1];
assert.ok(['stable-source-pinned-tuples', 'positive-alternatives-and-conflicts', 'held-out-and-stale-authority',
  'query-specific-queue-masks', 'zero-weight-and-missing-negative', 'original-task-retirement'].includes(mode));
if (mode === 'stable-source-pinned-tuples') {
  const fixture = retrievalTrainingFixture(), cohort = compileRetrievalTrainingCohort(fixture.judgments);
  assert.equal(cohort.rows.length, 2); assert.equal(cohort.coverage.positivePairs, 4); assert.equal(cohort.coverage.negativePairs, 2);
  assert.equal(cohort.coverage.unknownPairs, 4); assert.equal(cohort.coverage.conflictPairs, 0); assert.equal(cohort.coverage.eligibleQueries, 2);
  assert.equal(cohort.splitManifestId, fixture.manifest.manifestId); assert.equal(cohort.split, 'train');
  assert.deepEqual(cohort.rows.map(row => row.queryId), cohort.rows.map(row => row.queryId).sort());
  for (const row of cohort.rows) {
    assert.equal(row.rawQueryHash, row.normalizedQueryHash); assert.equal(row.normalization, 'identity-raw-query-v1');
    assert.ok(row.provenance.reviewReceiptIds.length); assert.equal(row.provenance.aliases.length, 1);
    assert.deepEqual(row.pairs.map(pair => pair.documentId), row.pairs.map(pair => pair.documentId).sort());
    assert.ok(row.pairs.every(pair => pair.annotationIds.length && pair.annotations[0].receiptIds.length));
  }
  const reordered = retrievalTrainingFixture({ seeds: ['second', 'first'], alter({ packets }) {
    for (const packet of packets) { packet.judgments.reverse(); packet.judgments.push(structuredClone(packet.judgments[0])); }
  } });
  assert.equal(compileRetrievalTrainingCohort(reordered.judgments.reverse()).cohortId, cohort.cohortId);
  assert.ok(cohort.documents.every(doc => doc.text && doc.world.repositoryNamespace && doc.source.sourceHash));
  assert.throws(() => inspectRetrievalTrainingCohort({ ...cohort }));
} else if (mode === 'positive-alternatives-and-conflicts') {
  const fixture = retrievalTrainingFixture({ seeds: ['one'], alter({ packets }) {
    const packet = packets[0], positive = packet.judgments[0], alias = packet.judgments[4];
    packet.judgments.push({ ...positive, label: 'verified-negative', grade: 0, basis: 'named-requirement-counterexample' });
    alias.label = 'verified-negative'; alias.grade = 0; alias.weight = 1; alias.basis = 'explicit-task-relevance-annotation';
  } });
  const cohort = compileRetrievalTrainingCohort(fixture.judgments), pairs = cohort.rows[0].pairs;
  assert.equal(pairs.filter(row => row.label === 'conflict').length, 2, 'original and reviewed historical rename stay protected');
  assert.ok(pairs.filter(row => row.label === 'conflict').every(row => row.mask === 0 && row.weight === 0));
  assert.equal(pairs.filter(row => row.mask && row.label === 'positive').length, 1, 'the other accepted alternative remains positive');
  assert.equal(pairs.filter(row => row.mask && row.label === 'verified-negative').length, 1);
  const direct = retrievalTrainingFixture({ seeds: ['one'], alter({ packets }) {
    packets[0].judgments[0] = { ...packets[0].judgments[0], label: 'verified-negative', grade: 0, basis: 'named-requirement-counterexample' };
  } });
  assert.ok(compileRetrievalTrainingCohort(direct.judgments).rows[0].pairs.some(row => row.label === 'conflict'), 'even a lone negative cannot override the accepted oracle evidence');
} else if (mode === 'held-out-and-stale-authority') {
  for (const split of ['dev', 'calibration', 'test']) {
    const heldOut = retrievalTrainingFixture({ split });
    assert.throws(() => compileRetrievalTrainingCohort(heldOut.judgments), /training tasks/);
  }
  const fixture = retrievalTrainingFixture(), packet = fixture.packets[0];
  for (const field of ['compilationId', 'privateOracleId', 'splitManifestId', 'requirementId', 'rawQueryHash']) {
    const changed = structuredClone(packet); changed[field] = hash('stale-' + field);
    assert.throws(() => compileEvidenceTaskJudgments({ task: fixture.tasks[0], manifest: fixture.manifest, input: changed }), { code: 'ERR_EVIDENCE_TASK_JUDGMENTS' });
  }
  const staleSource = structuredClone(packet); staleSource.judgments[0].source.sourceHash = hash('changed source');
  assert.throws(() => compileEvidenceTaskJudgments({ task: fixture.tasks[0], manifest: fixture.manifest, input: staleSource }));
  const mismatchedAlias = structuredClone(packet); mismatchedAlias.positiveAliases[0].right = packet.judgments[2].source;
  assert.throws(() => compileEvidenceTaskJudgments({ task: fixture.tasks[0], manifest: fixture.manifest, input: mismatchedAlias }), /text equality/);
  assert.throws(() => compileEvidenceTaskJudgments({ task: fixture.tasks[0], manifest: { ...fixture.manifest }, input: packet }));
  assert.throws(() => compileRetrievalTrainingCohort([{ ...fixture.judgments[0] }]));
} else if (mode === 'query-specific-queue-masks') {
  const cohort = compileRetrievalTrainingCohort(retrievalTrainingFixture().judgments), [first, second] = cohort.rows;
  const ownPositive = first.pairs.find(row => row.label === 'positive').documentId;
  const otherNegative = second.pairs.find(row => row.label === 'verified-negative').documentId;
  const mask = retrievalTrainingMask(cohort, first.queryId, [otherNegative, ownPositive, ownPositive]);
  assert.equal(mask.length, 2); assert.equal(mask.find(row => row.documentId === ownPositive).mask, 1);
  assert.deepEqual(mask.find(row => row.documentId === otherNegative), { documentId: otherNegative, label: 'unknown', mask: 0, grade: 0,
    weight: 0, reason: 'no-query-specific-annotation', annotations: [], annotationIds: [] });
  assert.equal(retrievalTrainingMask(cohort, second.queryId, [otherNegative])[0].label, 'verified-negative');
  assert.throws(() => retrievalTrainingMask(cohort, first.queryId, [hash('not-a-source')]));
  assert.notEqual(first.world.repositoryNamespace, second.world.repositoryNamespace);
} else if (mode === 'zero-weight-and-missing-negative') {
  const fixture = retrievalTrainingFixture({ seeds: ['one'], alter({ packets }) { packets[0].judgments[2].weight = 0; } });
  const cohort = compileRetrievalTrainingCohort(fixture.judgments);
  assert.equal(cohort.coverage.eligibleQueries, 0); assert.equal(cohort.coverage.negativePairs, 0);
  assert.equal(cohort.coverage.skippedWithoutPositiveOrNegative, 1);
  const noLabel = retrievalTrainingFixture({ seeds: ['one'], alter({ packets }) { packets[0].judgments.splice(2, 1); } });
  assert.equal(compileRetrievalTrainingCohort(noLabel.judgments).coverage.negativePairs, 0, 'absence never invents a negative');
} else {
  const fixture = retrievalTrainingFixture();
  assert.equal(inspectEvidenceTaskJudgments(fixture.judgments[0]).split, 'train');
  disposeEvidenceTask(fixture.tasks[0]);
  assert.throws(() => inspectEvidenceTaskJudgments(fixture.judgments[0]));
  assert.throws(() => compileRetrievalTrainingCohort(fixture.judgments));
  assert.equal(inspectEvidenceTaskJudgments(fixture.judgments[1]).split, 'train', 'an independent source owner stays available');
  const aborted = new AbortController(); aborted.abort(0);
  assert.throws(() => compileRetrievalTrainingCohort([fixture.judgments[1]], { signal: aborted.signal }), { name: 'AbortError', cause: 0 });
}
console.log('Training cohorts retain original task authority, explicit labels, conflicts and per-query masks.');
