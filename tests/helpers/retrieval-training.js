import { createHash } from 'node:crypto';
import { retrievalTrainingFixture } from './retrieval-training-cohort.js';
import { directionalQuerySpec } from './directional-query.js';
import { compileRetrievalTrainingCohort } from '../../src/shared/retrieval-adaptation/cohort.js';
import { compileFrozenRetrievalVectors, retrievalTrainingObjectiveId, createRetrievalTrainingSession,
  advanceRetrievalTraining, exportRetrievalTrainingCheckpoint } from '../../src/shared/retrieval-adaptation/training.js';

export const retrievalTrainerFixture = ({ seeds = ['training'], alter = null, totalSteps = 64, objective = 'any-positive' } = {}) => {
  const fixture = retrievalTrainingFixture({ seeds, alter }), cohort = compileRetrievalTrainingCohort(fixture.judgments);
  const runSpec = { schemaVersion: 1, optimizer: 'sgd-momentum-f32-v1', sampler: 'sha256-epoch-permutation-v1',
    numericalGradient: 'cosine-f64; normalization-f64; output-f32-straight-through-v1', objective, temperature: 0.5,
    learningRate: 0.5, momentum: 0.5, factorL2: 0, maxGradientNorm: 10, seed: 'tiny-cpu-training', totalSteps };
  const spec = directionalQuerySpec({ dimensions: 2, rank: 1, trained: true });
  Object.assign(spec, { trainingCohortId: cohort.cohortId, splitManifestId: cohort.splitManifestId,
    sourceDependencies: cohort.sourceDependencies, rightsScopeId: cohort.rows[0].rightsScopeId, objectiveId: retrievalTrainingObjectiveId(runSpec) });
  const queries = cohort.rows.map(row => ({ id: row.queryId, inputHash: row.rawQueryHash, vector: new Float32Array([1, 0]) }));
  const documents = cohort.documents.map(doc => {
    const positive = cohort.rows.some(row => row.pairs.some(pair => pair.documentId === doc.documentId && pair.label === 'positive'));
    return { id: doc.documentId, inputHash: createHash('sha256').update(doc.text).digest('hex'), vector: new Float32Array(positive ? [0, 1] : [1, 0]) };
  });
  const vectors = compileFrozenRetrievalVectors({ cohort, queryContract: spec.query, documentContract: spec.document, queries, documents });
  const create = checkpoint => createRetrievalTrainingSession({ cohort, vectors, spec, runSpec, ...(checkpoint ? { checkpoint } : {}) });
  return { ...fixture, cohort, runSpec, spec, queries, documents, vectors, create };
};
export const finishRetrievalTraining = async session => {
  let checkpoint = exportRetrievalTrainingCheckpoint(session);
  while (checkpoint.sampler.step < checkpoint.runSpec.totalSteps) {
    await advanceRetrievalTraining(session, { steps: 1000, maxMs: 1000 }); checkpoint = exportRetrievalTrainingCheckpoint(session);
  }
  return checkpoint;
};
