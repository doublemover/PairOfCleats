import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { retrievalTrainerFixture, finishRetrievalTraining } from '../../helpers/retrieval-training.js';
import { compileFrozenRetrievalVectors, inspectFrozenRetrievalVectors, createRetrievalTrainingSession,
  advanceRetrievalTraining, exportRetrievalTrainingCheckpoint, disposeRetrievalTraining,
  disposeFrozenRetrievalVectors } from '../../../src/shared/retrieval-adaptation/training.js';
import { invalidateRetrievalTrainingCohort } from '../../../src/shared/retrieval-adaptation/cohort.js';
import { openDirectionalQueryAdapter, projectDirectionalQuery, disposeDirectionalQueryAdapter } from '../../../src/shared/retrieval-adaptation/directional-query.js';
import { evaluateMaskedContrastiveObjective } from '../../../src/shared/retrieval-adaptation/contrastive-objective.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/retrieval-training/')[1];
assert.ok(['frozen-vector-binding', 'first-gradient-and-export-parity', 'deterministic-resume', 'stale-and-corrupt-resume',
  'cancellation-and-overlap', 'missing-negative-skips-updates', 'retracted-inputs-refuse-continuation', 'overflow-keeps-complete-checkpoint'].includes(mode));
const rehash = checkpoint => {
  const { checkpointId: _id, ...content } = checkpoint;
  checkpoint.checkpointId = semanticHash('retrieval-adaptation.training.checkpoint.v1', content, { maxBytes: 8 * 1024 * 1024 }); return checkpoint;
};
const repack = (fixture, documents = fixture.documents) => compileFrozenRetrievalVectors({ cohort: fixture.cohort,
  queryContract: fixture.spec.query, documentContract: fixture.spec.document, queries: fixture.queries, documents });
const evaluateExport = (fixture, artifact) => {
  const adapter = openDirectionalQueryAdapter(artifact), row = fixture.cohort.rows[0];
  try {
    const { vector } = projectDirectionalQuery(adapter, { query: fixture.queries[0].vector,
      queryContract: fixture.spec.query, documentContract: fixture.spec.document });
    const norm = Math.hypot(...vector), scores = row.pairs.map(pair => {
      const document = fixture.documents.find(doc => doc.id === pair.documentId).vector, documentNorm = Math.hypot(...document);
      let score = 0; for (let i = 0; i < vector.length; i++) score += vector[i] / norm * document[i] / documentNorm;
      return { documentId: pair.documentId, score: Math.max(-1, Math.min(1, score)) };
    });
    return evaluateMaskedContrastiveObjective({ cohort: fixture.cohort, queryId: row.queryId, scores,
      objective: fixture.runSpec.objective, temperature: fixture.runSpec.temperature });
  } finally { disposeDirectionalQueryAdapter(adapter); }
};
if (mode === 'frozen-vector-binding') {
  const fixture = retrievalTrainerFixture(), report = inspectFrozenRetrievalVectors(fixture.vectors), session = fixture.create();
  const original = exportRetrievalTrainingCheckpoint(session);
  for (const row of [...fixture.queries, ...fixture.documents]) row.vector.fill(0);
  assert.equal(inspectFrozenRetrievalVectors(fixture.vectors), report);
  await advanceRetrievalTraining(session); assert.equal(exportRetrievalTrainingCheckpoint(session).updates, 1);
  assert.throws(() => repack(fixture), /zero or invalid norm/);
  const other = retrievalTrainerFixture(); other.documents[0].inputHash = 'f'.repeat(64);
  assert.throws(() => repack(other), /input identity/);
  assert.throws(() => createRetrievalTrainingSession({ cohort: fixture.cohort, vectors: { ...fixture.vectors }, spec: fixture.spec, runSpec: fixture.runSpec }));
  assert.throws(() => disposeFrozenRetrievalVectors(fixture.vectors), /after all training sessions/);
  assert.equal(disposeRetrievalTraining(session).status, 'retired');
  const retired = disposeFrozenRetrievalVectors(fixture.vectors); assert.equal(disposeFrozenRetrievalVectors(fixture.vectors), retired);
  assert.throws(() => inspectFrozenRetrievalVectors(fixture.vectors)); assert.ok(original.vectorSetId);
} else if (mode === 'first-gradient-and-export-parity') {
  const fixture = retrievalTrainerFixture(), session = fixture.create(), before = exportRetrievalTrainingCheckpoint(session);
  const sourceBytes = fixture.documents.map(row => Buffer.from(row.vector.buffer).toString('hex'));
  const initialLoss = evaluateExport(fixture, before.artifact).loss;
  await advanceRetrievalTraining(session);
  const first = exportRetrievalTrainingCheckpoint(session);
  assert.ok(Buffer.from(first.artifact.u.data, 'base64').some(byte => byte !== 0), 'U receives the first nonzero gradient');
  assert.equal(first.artifact.v.data, before.artifact.v.data, 'U=0 leaves V gradient zero on the first step');
  assert.ok(Math.abs(first.lastLoss - initialLoss) < 1e-12, 'training forward matches exported inference');
  const final = await finishRetrievalTraining(session);
  assert.equal(final.updates, fixture.runSpec.totalSteps); assert.ok(evaluateExport(fixture, final.artifact).loss < initialLoss - 0.01);
  assert.deepEqual(fixture.documents.map(row => Buffer.from(row.vector.buffer).toString('hex')), sourceBytes);
} else if (mode === 'deterministic-resume') {
  for (const objective of ['any-positive', 'mean-positive', 'graded-positive']) {
    const fixture = retrievalTrainerFixture({ seeds: ['first', 'second'], objective }), original = fixture.create();
    await advanceRetrievalTraining(original, { steps: 7 }); const checkpoint = exportRetrievalTrainingCheckpoint(original);
    const resumed = fixture.create(JSON.parse(JSON.stringify(checkpoint)));
    const uninterrupted = await finishRetrievalTraining(original), restored = await finishRetrievalTraining(resumed);
    assert.deepEqual(restored, uninterrupted, 'factors, momentum, sampler and final IDs replay byte-exactly');
    assert.equal(restored.sampler.step, fixture.runSpec.totalSteps);
  }
} else if (mode === 'stale-and-corrupt-resume') {
  const fixture = retrievalTrainerFixture(), session = fixture.create(); await advanceRetrievalTraining(session, { steps: 3 });
  const checkpoint = exportRetrievalTrainingCheckpoint(session);
  for (const change of [row => { row.vectorSetId = 'f'.repeat(64); }, row => { row.sampler.offset++; },
    row => { row.runSpec.temperature = 0.4; }, row => { row.artifact.u.data = row.artifact.u.data.slice(4); },
    row => { row.cohortId = 'e'.repeat(64); }]) {
    const changed = structuredClone(checkpoint); change(changed); rehash(changed); assert.throws(() => fixture.create(changed));
  }
  const nonfinite = structuredClone(checkpoint), bytes = Buffer.from(nonfinite.momentumU.data, 'base64'); bytes.writeFloatLE(NaN, 0);
  nonfinite.momentumU.data = bytes.toString('base64'); nonfinite.momentumU.sha256 = createHash('sha256').update(bytes).digest('hex'); rehash(nonfinite);
  assert.throws(() => fixture.create(nonfinite));
  const changedDocuments = fixture.documents.map(row => ({ ...row, vector: new Float32Array([0, 1]) }));
  const vectors = repack(fixture, changedDocuments);
  assert.throws(() => createRetrievalTrainingSession({ cohort: fixture.cohort, vectors, spec: fixture.spec, runSpec: fixture.runSpec, checkpoint }));
  const initial = structuredClone(exportRetrievalTrainingCheckpoint(fixture.create()));
  const zero = Buffer.alloc(Buffer.from(initial.artifact.v.data, 'base64').length);
  initial.artifact.v.data = zero.toString('base64'); initial.artifact.v.sha256 = createHash('sha256').update(zero).digest('hex');
  const { pairId: _initialPair, ...initialArtifact } = initial.artifact;
  initial.artifact.pairId = semanticHash('directional-query.artifact.v1', initialArtifact, { maxBytes: 4 * 1024 * 1024 }); rehash(initial);
  assert.throws(() => fixture.create(initial), /nonzero-gradient initialization/);
} else if (mode === 'cancellation-and-overlap') {
  const fixture = retrievalTrainerFixture(), session = fixture.create(), before = exportRetrievalTrainingCheckpoint(session);
  const pre = new AbortController(); pre.abort(0);
  await assert.rejects(advanceRetrievalTraining(session, { signal: pre.signal }), { name: 'AbortError', cause: 0 });
  assert.deepEqual(exportRetrievalTrainingCheckpoint(session), before);
  const abort = new AbortController(), pending = advanceRetrievalTraining(session, { steps: 1000, signal: abort.signal });
  assert.throws(() => exportRetrievalTrainingCheckpoint(session), /complete advance boundary/);
  assert.throws(() => disposeRetrievalTraining(session), /in-flight/);
  await assert.rejects(advanceRetrievalTraining(session), /non-overlapping/); setImmediate(() => abort.abort(false));
  await assert.rejects(pending, { name: 'AbortError', cause: false });
  const partial = exportRetrievalTrainingCheckpoint(session); assert.ok(partial.sampler.step > 0 && partial.sampler.step < fixture.runSpec.totalSteps);
  const resumed = fixture.create(partial), baseline = fixture.create();
  assert.deepEqual(await finishRetrievalTraining(resumed), await finishRetrievalTraining(baseline));
} else if (mode === 'missing-negative-skips-updates') {
  const fixture = retrievalTrainerFixture({ totalSteps: 3, alter({ packets }) { for (const packet of packets) packet.judgments[2].weight = 0; } });
  const session = fixture.create(), initial = exportRetrievalTrainingCheckpoint(session), final = await finishRetrievalTraining(session);
  assert.equal(final.skipped, 3); assert.equal(final.updates, 0); assert.equal(final.lastLoss, null);
  assert.equal(final.artifact.pairId, initial.artifact.pairId); assert.equal(final.artifact.u.data, initial.artifact.u.data);
} else if (mode === 'retracted-inputs-refuse-continuation') {
  for (const kind of ['source-retracted', 'judgment-retracted']) {
    const fixture = retrievalTrainerFixture(), session = fixture.create(), checkpoint = exportRetrievalTrainingCheckpoint(session);
    const dependencyId = kind === 'source-retracted' ? fixture.cohort.sourceDependencies[0] : fixture.cohort.rows[0].judgmentSetId;
    const receipt = invalidateRetrievalTrainingCohort(fixture.cohort, { kind, dependencyId }); assert.equal(receipt.recovery, 'clean-cohort-and-retrain');
    await assert.rejects(advanceRetrievalTraining(session), /Retracted/); assert.throws(() => exportRetrievalTrainingCheckpoint(session), /Retracted/);
    assert.throws(() => fixture.create(checkpoint), /Retracted/);
    assert.equal(disposeRetrievalTraining(session).status, 'retired'); assert.equal(disposeFrozenRetrievalVectors(fixture.vectors).status, 'retired');
  }
} else {
  const fixture = retrievalTrainerFixture(), original = fixture.create(), checkpoint = structuredClone(exportRetrievalTrainingCheckpoint(original));
  const set = (factor, value) => {
    const bytes = Buffer.from(factor.data, 'base64'); for (let i = 0; i < bytes.length; i += 4) bytes.writeFloatLE(value, i);
    factor.data = bytes.toString('base64'); factor.sha256 = createHash('sha256').update(bytes).digest('hex');
  };
  set(checkpoint.artifact.u, -3.4e38); set(checkpoint.momentumU, 3.4e38);
  const { pairId: _pair, ...artifact } = checkpoint.artifact;
  checkpoint.artifact.pairId = semanticHash('directional-query.artifact.v1', artifact, { maxBytes: 4 * 1024 * 1024 }); rehash(checkpoint);
  checkpoint.sampler = { step: 1, epoch: 1, offset: 0 }; checkpoint.updates = 1; checkpoint.lastLoss = 1; rehash(checkpoint);
  const session = fixture.create(checkpoint), before = exportRetrievalTrainingCheckpoint(session);
  await assert.rejects(advanceRetrievalTraining(session), /optimizer overflow/);
  assert.deepEqual(exportRetrievalTrainingCheckpoint(session), before, 'failed numerical work cannot partially commit factors or sampler');
}
console.log('CPU query training binds frozen vectors and preserves deterministic complete-update checkpoints.');
