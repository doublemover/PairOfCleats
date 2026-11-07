import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { semanticHash } from '../../index/semantic/identity.js';
import { captureRetrievalAdaptation } from '../../contracts/validators/retrieval-adaptation.js';
import { assertEmbeddingArtifactCompatibility } from '../embedding-artifact-identity.js';
import { admitEmbeddingVector } from '../embedding-output-admission.js';
import { throwIfAborted } from '../abort.js';
import { inspectRetrievalTrainingCohort } from './cohort.js';
import { evaluateMaskedContrastiveObjective } from './contrastive-objective.js';
import { captureAdaptationNumbers, applyResidualQueryKernel } from './numeric.js';
import { encodeAdaptationFactors, decodeAdaptationFactors } from './factor-bytes.js';
import { captureDirectionalQuerySpec, directionalQueryContractIdentity, directionalDocumentSpaceIdentity,
  createIdentityDirectionalQueryArtifact, createDirectionalQueryArtifact, openDirectionalQueryAdapter,
  disposeDirectionalQueryAdapter } from './directional-query.js';

const vectorSets = new WeakMap(), sessions = new WeakMap(), retired = new WeakMap(), retiredVectors = new WeakMap();
const hash = (kind, value) => semanticHash('retrieval-adaptation.training.' + kind + '.v1', value, { maxBytes: 8 * 1024 * 1024 });
const textHash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_ADAPTATION_TRAINING' });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const optimizerFloat = value => { const rounded = Math.fround(value); return rounded === 0 ? 0 : rounded; };
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const ownRow = row => {
  if (!row || typeof row !== 'object' || types.isProxy(row) || ![Object.prototype, null].includes(Object.getPrototypeOf(row))
    || Object.getOwnPropertySymbols(row).length || Object.getOwnPropertyNames(row).sort().join() !== 'id,inputHash,vector') throw fail('Exact data-only vector records required.');
  const result = {};
  for (const key of ['id', 'inputHash', 'vector']) {
    const descriptor = Object.getOwnPropertyDescriptor(row, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('Accessor vector records are not admitted.');
    result[key] = descriptor.value;
  }
  return result;
};

/** Original source-bound float snapshots, not an encoder-execution receipt.
 * Import copies values and binds every actual byte; no caller cache is mutated.
 */
export const compileFrozenRetrievalVectors = ({ cohort, queryContract, documentContract, queries, documents }) => {
  inspectRetrievalTrainingCohort(cohort);
  queryContract = captureRetrievalAdaptation('query', queryContract); documentContract = captureRetrievalAdaptation('document', documentContract);
  if (queryContract.dimensions !== documentContract.dimensions || documentContract.representation !== 'original-float32'
    || documentContract.quantizationId !== null) throw fail('The initial trainer requires matched-width original-float32 document targets.');
  for (const contract of [queryContract, documentContract]) assertEmbeddingArtifactCompatibility(contract.artifact, contract.artifact);
  const dimensions = queryContract.dimensions, queryMap = new Map(), documentMap = new Map(), inventory = [];
  let values = 0;
  for (const [role, supplied, expected, destination] of [['query', queries, cohort.rows, queryMap], ['document', documents, cohort.documents, documentMap]]) {
    if (!Array.isArray(supplied) || types.isProxy(supplied) || supplied.length !== expected.length || supplied.length > 1024) throw fail('Every original cohort query/document needs exactly one bounded vector record.');
    const expectedMap = new Map(expected.map(row => [row.queryId ?? row.documentId, row]));
    for (let index = 0; index < supplied.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(supplied, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('Sparse/accessor vector collections are not admitted.');
      const record = ownRow(descriptor.value), original = expectedMap.get(record.id);
      if (!original || destination.has(record.id) || record.inputHash !== (role === 'query' ? original.rawQueryHash : textHash(original.text))) throw fail('Vector source input identity changed or repeated.');
      values += dimensions; if (values > 1048576) throw fail('Frozen-vector input exceeds its 1,048,576-value allowance.');
      const vector = captureAdaptationNumbers(record.vector, dimensions);
      admitEmbeddingVector(vector, { dimensions, requireNonzero: true, unitNorm: role === 'document' });
      const encoded = encodeAdaptationFactors(vector, dimensions), norm = Math.hypot(...vector);
      destination.set(record.id, { vector, norm }); inventory.push({ role, id: record.id, inputHash: record.inputHash, sha256: encoded.sha256 });
    }
  }
  inventory.sort((a, b) => order(a.role, b.role) || order(a.id, b.id));
  const content = { cohortId: cohort.cohortId, queryContractId: directionalQueryContractIdentity(queryContract),
    documentSpaceId: directionalDocumentSpaceIdentity(documentContract), inventory };
  const report = immutable({ schemaVersion: 1, kind: 'source-bound-frozen-retrieval-vectors', ...content,
    vectorSetId: hash('vector-set', content), values, bytes: values * 4,
    encodingAuthority: 'supplied-source-bound-floats; encoder-not-independently-reexecuted', documentMutation: 'none' });
  const handle = Object.freeze({ version: 1 }); vectorSets.set(handle, { cohort, queryContract, documentContract, queryMap, documentMap, report, activeSessions: 0 }); return handle;
};
const getVectors = handle => {
  const state = handle && typeof handle === 'object' ? vectorSets.get(handle) : null;
  if (!state) throw fail('Original frozen retrieval vector set required.'); return state;
};
export const inspectFrozenRetrievalVectors = handle => getVectors(handle).report;
export const disposeFrozenRetrievalVectors = handle => {
  if (handle && typeof handle === 'object' && retiredVectors.has(handle)) return retiredVectors.get(handle);
  const state = getVectors(handle); if (state.activeSessions) throw fail('Retire the original vector set only after all training sessions.');
  const receipt = Object.freeze({ status: 'retired', vectorSetId: state.report.vectorSetId, nativeResources: 'none' });
  vectorSets.delete(handle); retiredVectors.set(handle, receipt); return receipt;
};
export const retrievalTrainingObjectiveId = input => hash('objective-and-optimizer', captureRetrievalAdaptation('run', input));
const artifactFor = state => createDirectionalQueryArtifact({ spec: state.spec, u: state.u, v: state.v });
const get = handle => {
  const state = handle && typeof handle === 'object' ? sessions.get(handle) : null;
  if (!state) throw fail('Original live retrieval training session required.'); return state;
};
const exportCheckpoint = state => {
  const count = state.cohort.rows.length;
  const content = { schemaVersion: 1, kind: 'directional-query-training-checkpoint', cohortId: state.cohort.cohortId,
    vectorSetId: state.vectors.report.vectorSetId, runSpec: state.runSpec, artifact: artifactFor(state),
    momentumU: encodeAdaptationFactors(state.momentumU, state.u.length), momentumV: encodeAdaptationFactors(state.momentumV, state.v.length),
    sampler: { step: state.step, epoch: Math.floor(state.step / count), offset: state.step % count },
    updates: state.updates, skipped: state.skipped, lastLoss: state.lastLoss };
  return immutable({ ...content, checkpointId: hash('checkpoint', content) });
};

export const createRetrievalTrainingSession = ({ cohort, vectors: handle, spec, runSpec, checkpoint = null }) => {
  inspectRetrievalTrainingCohort(cohort); const vectors = getVectors(handle);
  spec = captureDirectionalQuerySpec(spec); runSpec = captureRetrievalAdaptation('run', runSpec);
  if (vectors.cohort !== cohort || spec.purpose !== 'trained-candidate' || spec.trainingCohortId !== cohort.cohortId
    || spec.splitManifestId !== cohort.splitManifestId || spec.objectiveId !== retrievalTrainingObjectiveId(runSpec)
    || spec.sourceDependencies.join() !== cohort.sourceDependencies.join()
    || cohort.rows.some(row => row.rightsScopeId !== spec.rightsScopeId)
    || directionalQueryContractIdentity(spec.query) !== vectors.report.queryContractId
    || directionalDocumentSpaceIdentity(spec.document) !== vectors.report.documentSpaceId) throw fail('Training cohort, vectors, objective, rights, sources or directional space changed.');
  const initial = createIdentityDirectionalQueryArtifact({ ...spec, purpose: 'identity-control', trainingCohortId: null,
    splitManifestId: null, sourceDependencies: [] }, { seed: runSpec.seed });
  const length = spec.query.dimensions * spec.rank, initialV = decodeAdaptationFactors(initial.v, length);
  const state = { cohort, vectors, spec, runSpec, u: decodeAdaptationFactors(initial.u, length), v: initialV.slice(), initialV,
    momentumU: new Float32Array(length), momentumV: new Float32Array(length), step: 0, updates: 0, skipped: 0, lastLoss: null, busy: false };
  if (checkpoint !== null) {
    checkpoint = captureRetrievalAdaptation('checkpoint', checkpoint);
    const { checkpointId, ...content } = checkpoint;
    if (hash('checkpoint', content) !== checkpointId || checkpoint.cohortId !== cohort.cohortId
      || checkpoint.vectorSetId !== vectors.report.vectorSetId || retrievalTrainingObjectiveId(checkpoint.runSpec) !== spec.objectiveId
      || hash('directional-spec', checkpoint.artifact.spec) !== hash('directional-spec', spec)
      || checkpoint.sampler.step > runSpec.totalSteps || checkpoint.updates + checkpoint.skipped !== checkpoint.sampler.step
      || checkpoint.sampler.epoch !== Math.floor(checkpoint.sampler.step / cohort.rows.length)
      || checkpoint.sampler.offset !== checkpoint.sampler.step % cohort.rows.length) throw fail('Resume checkpoint identity or complete-update sampler state changed.');
    const admitted = openDirectionalQueryAdapter(checkpoint.artifact); disposeDirectionalQueryAdapter(admitted);
    if (checkpoint.sampler.step === 0 && (checkpoint.artifact.pairId !== artifactFor(state).pairId
      || checkpoint.momentumU.sha256 !== encodeAdaptationFactors(state.momentumU, length).sha256
      || checkpoint.momentumV.sha256 !== encodeAdaptationFactors(state.momentumV, length).sha256
      || checkpoint.lastLoss !== null)) throw fail('Initial checkpoints must retain the seeded nonzero-gradient initialization and zero momentum.');
    state.u = decodeAdaptationFactors(checkpoint.artifact.u, length); state.v = decodeAdaptationFactors(checkpoint.artifact.v, length);
    state.momentumU = decodeAdaptationFactors(checkpoint.momentumU, length); state.momentumV = decodeAdaptationFactors(checkpoint.momentumV, length);
    Object.assign(state, { step: checkpoint.sampler.step, updates: checkpoint.updates, skipped: checkpoint.skipped, lastLoss: checkpoint.lastLoss });
  }
  const token = Object.freeze({ version: 1 }); sessions.set(token, state); vectors.activeSessions++; return token;
};

const sample = state => {
  const epoch = Math.floor(state.step / state.cohort.rows.length), offset = state.step % state.cohort.rows.length;
  const rows = state.cohort.rows.map(row => ({ row, key: hash('sample', { seed: state.runSpec.seed, epoch, queryId: row.queryId }) }));
  rows.sort((a, b) => order(a.key, b.key) || order(a.row.queryId, b.row.queryId)); return rows[offset].row;
};
const trainStep = state => {
  const row = sample(state), { runSpec, spec, u, v } = state, d = spec.query.dimensions, r = spec.rank;
  if (!row.eligible) { state.step++; state.skipped++; state.lastLoss = null; return; }
  const input = state.vectors.queryMap.get(row.queryId).vector;
  const forward = applyResidualQueryKernel({ input, u, v, dimensions: d, rank: r });
  const queryNorm = Math.hypot(...forward.vector), scores = [], normalizedDocuments = new Map();
  for (const pair of row.pairs) {
    const { vector, norm } = state.vectors.documentMap.get(pair.documentId);
    let score = 0; for (let i = 0; i < d; i++) score += forward.vector[i] / queryNorm * (vector[i] / norm);
    if (Math.abs(score) > 1 + 1e-12 || !Number.isFinite(score)) throw fail('Cosine scoring produced an invalid value.');
    const cosine = Math.max(-1, Math.min(1, score));
    scores.push({ documentId: pair.documentId, score: cosine }); normalizedDocuments.set(pair.documentId, { vector, norm, score: cosine });
  }
  const objective = evaluateMaskedContrastiveObjective({ cohort: state.cohort, queryId: row.queryId, scores,
    objective: runSpec.objective, temperature: runSpec.temperature });
  if (objective.skipped) { state.step++; state.skipped++; state.lastLoss = null; return; }
  const gradQuery = new Float64Array(d), gradRaw = new Float64Array(d), gradU = new Float64Array(u.length), gradV = new Float64Array(v.length);
  for (const gradient of objective.gradients) {
    if (gradient.scoreGradient === 0) continue;
    const { vector, norm, score } = normalizedDocuments.get(gradient.documentId);
    for (let i = 0; i < d; i++) gradQuery[i] += gradient.scoreGradient * (vector[i] / norm - score * forward.vector[i] / queryNorm) / queryNorm;
  }
  let radial = 0; for (let i = 0; i < d; i++) radial += gradQuery[i] * forward.projected[i] / forward.norm;
  for (let i = 0; i < d; i++) gradRaw[i] = (gradQuery[i] - forward.projected[i] / forward.norm * radial) / forward.norm;
  for (let i = 0; i < d; i++) for (let k = 0; k < r; k++) gradU[i * r + k] = gradRaw[i] * forward.middle[k];
  for (let k = 0; k < r; k++) {
    let gradient = 0; for (let i = 0; i < d; i++) gradient += u[i * r + k] * gradRaw[i];
    for (let i = 0; i < d; i++) gradV[i * r + k] = input[i] * gradient;
  }
  let regularization = 0, gradientNorm = 0;
  for (let i = 0; i < u.length; i++) {
    const deltaV = v[i] - state.initialV[i]; regularization += runSpec.factorL2 * (u[i] ** 2 + deltaV ** 2);
    gradU[i] += 2 * runSpec.factorL2 * u[i]; gradV[i] += 2 * runSpec.factorL2 * deltaV;
    gradientNorm = Math.hypot(gradientNorm, gradU[i], gradV[i]);
  }
  if (!Number.isFinite(gradientNorm) || !Number.isFinite(regularization)) throw fail('Nonfinite gradient or regularizer; previous complete update retained.');
  const scale = gradientNorm > runSpec.maxGradientNorm ? runSpec.maxGradientNorm / gradientNorm : 1;
  const nextU = new Float32Array(u.length), nextV = new Float32Array(v.length), momentumU = new Float32Array(u.length), momentumV = new Float32Array(v.length);
  for (let i = 0; i < u.length; i++) {
    momentumU[i] = optimizerFloat(runSpec.momentum * state.momentumU[i] + gradU[i] * scale);
    momentumV[i] = optimizerFloat(runSpec.momentum * state.momentumV[i] + gradV[i] * scale);
    nextU[i] = optimizerFloat(u[i] - runSpec.learningRate * momentumU[i]);
    nextV[i] = optimizerFloat(v[i] - runSpec.learningRate * momentumV[i]);
    if (![momentumU[i], momentumV[i], nextU[i], nextV[i]].every(Number.isFinite)) throw fail('Float32 optimizer overflow; previous complete update retained.');
  }
  Object.assign(state, { u: nextU, v: nextV, momentumU, momentumV, step: state.step + 1, updates: state.updates + 1,
    lastLoss: objective.loss + regularization });
};

/** Complete-update boundaries only. Cancellation/deadline preserves the last
 * valid state; no new export is published or document bytes rewritten.
 */
export const advanceRetrievalTraining = async (handle, { steps = 1, maxMs = 1000, signal = null } = {}) => {
  const state = get(handle); throwIfAborted(signal); inspectRetrievalTrainingCohort(state.cohort);
  if (state.busy || !Number.isSafeInteger(steps) || steps < 1 || steps > 1000 || !Number.isSafeInteger(maxMs)
    || maxMs < 1 || maxMs > 1000) throw fail('One bounded non-overlapping advance required.');
  const began = performance.now(), end = Math.min(state.step + steps, state.runSpec.totalSteps); state.busy = true;
  try {
    while (state.step < end && performance.now() - began < maxMs) {
      throwIfAborted(signal); inspectRetrievalTrainingCohort(state.cohort); trainStep(state); await yieldImmediate();
    }
    throwIfAborted(signal); inspectRetrievalTrainingCohort(state.cohort);
    return Object.freeze({ step: state.step, updates: state.updates, skipped: state.skipped, lastLoss: state.lastLoss,
      complete: state.step === state.runSpec.totalSteps, requestedBoundaryReached: state.step === end,
      elapsedMs: performance.now() - began, policyQualification: 'not-established' });
  } finally { state.busy = false; }
};
export const exportRetrievalTrainingCheckpoint = handle => {
  const state = get(handle); inspectRetrievalTrainingCohort(state.cohort);
  if (state.busy) throw fail('Wait for the complete advance boundary before exporting a checkpoint.'); return exportCheckpoint(state);
};
export const disposeRetrievalTraining = handle => {
  if (handle && typeof handle === 'object' && retired.has(handle)) return retired.get(handle);
  const state = get(handle); if (state.busy) throw fail('An in-flight advance must settle before retirement.');
  const receipt = Object.freeze({ status: 'retired', step: state.step, nativeResources: 'none', documentMutation: 'none' });
  sessions.delete(handle); state.vectors.activeSessions--; retired.set(handle, receipt); return receipt;
};
