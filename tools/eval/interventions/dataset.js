import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { snapshotEvaluationData } from '../../../src/retrieval/evaluation/plain-data.js';
import { readEvaluationData } from '../passive-evidence.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { getOfflineEvaluationAdapter } from '../adapters.js';

const prepared = new WeakSet(), MAX_INPUT_BYTES = 8 * 1024 * 1024, MAX_TRIALS = 32;
const fail = message => Object.assign(new Error(message), { code: 'ERR_EVAL_INTERVENTION_INPUT' });
const key = value => canonicalSemanticJson(value, { maxBytes: MAX_INPUT_BYTES });
const hash = value => semanticHash('offline-intervention-dataset.v1', value, { maxBytes: MAX_INPUT_BYTES });
const queryHash = query => createHash('sha256').update(query.trim()).digest('hex');
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};

/** Capture only optional offline data, before search. Saved labels/model inputs
 * never enter current query arguments, cohort identity or live quality metrics.
 * Known malformed metadata is retained as a refused row; inspection failures
 * and unrelated exceptions propagate rather than becoming a silent omission.
 */
export const captureDatasetInterventions = async cases => {
  const began = performance.now();
  if (!Array.isArray(cases)) throw fail('Captured evaluation cases required.');
  const entries = []; let inputBytes = 0, trialCount = 0;
  const append = entry => {
    if (entries.length === 64) throw fail('Offline intervention dataset exceeds the selected-case allowance.'); entries.push(entry);
  };
  for (const [caseIndex, row] of cases.entries()) {
    const entry = row.entry;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof row.query !== 'string' || !row.query.trim()) throw fail('Original evaluation case/query required.');
    let field;
    try { field = readEvaluationData(entry, 'interventionEvidence', fail); }
    catch (error) {
      if (error?.code !== 'ERR_EVAL_INTERVENTION_INPUT') throw error;
      append({ caseIndex, status: 'refused-input', code: error.code, reason: error.message }); continue;
    }
    if (!field.present) continue;
    try {
      const data = snapshotEvaluationData(field.value, { maxBytes: Math.max(1, MAX_INPUT_BYTES - inputBytes), maxDepth: 48,
        maxItems: 8192, code: 'ERR_EVAL_INTERVENTION_INPUT' });
      const bytes = Buffer.byteLength(key(data));
      if (inputBytes + bytes > MAX_INPUT_BYTES) throw fail('Offline intervention dataset exceeds aggregate input bounds.');
      inputBytes += bytes; append({ caseIndex, status: 'snapshot', expectedQueryDigest: queryHash(row.query), data: immutable(data) });
    } catch (error) {
      if (error?.code !== 'ERR_EVAL_INTERVENTION_INPUT') throw error;
      append({ caseIndex, status: 'refused-input', code: error.code, reason: error.message });
    }
  }
  if (!entries.length) return null;
  // All caller containers are owned before the first asynchronous import.
  // Ordinary datasets never import/compile the optional profile schemas.
  const assertInterventionDataset = entries.some(entry => entry.status === 'snapshot')
    ? (await import('../../../src/contracts/validators/intervention-dataset.js')).assertInterventionDataset : null;
  for (const [index, entry] of entries.entries()) {
    if (entry.status !== 'snapshot') continue;
    const { caseIndex, data, expectedQueryDigest } = entry;
    try {
      // The authoritative owner captures plain, inert JSON containers before
      // Ajv's unique-item equality checks. Its snapshot has identical content;
      // null-prototype passive records must not invoke missing valueOf methods.
      const admitted = assertInterventionDataset(data);
      if (data.queryDigest !== expectedQueryDigest || new Set(data.trials.map(trial => trial.id)).size !== data.trials.length
        || data.trials.some(trial => trial.profile === 'origin-observation-v1' && trial.input.trace.identity.queryDigest !== data.queryDigest)) throw fail('Offline trial query identity or local trial identities differ.');
      if (trialCount + data.trials.length > MAX_TRIALS) throw fail('Offline intervention dataset exceeds aggregate trial bounds.');
      trialCount += data.trials.length; entries[index] = { caseIndex, status: 'captured', data: admitted };
    } catch (error) {
      if (error?.code !== 'ERR_EVAL_INTERVENTION_INPUT') throw error;
      entries[index] = { caseIndex, status: 'refused-input', rawInputId: hash(data), code: error.code, reason: error.message };
    }
  }
  const inputId = hash(entries);
  const result = immutable({ schemaVersion: 1, inputId, inputBytes, trialCount, entries, preparationMs: performance.now() - began }); prepared.add(result); return result;
};

const execute = async (trial, signal, maxMs) => {
  const began = performance.now(), adapter = await getOfflineEvaluationAdapter(trial.profile); throwIfAborted(signal);
  const remainingMs = () => Math.floor(maxMs - (performance.now() - began));
  if (remainingMs() < 1) return { complete: false, reason: 'adapter-admission-deadline' };
  if (trial.profile === 'finite-lookup-v1') {
    const { createFiniteCausalModel, finiteCausalModelWork } = await import('../../../src/graph/hypotheses/finite-model.js');
    throwIfAborted(signal);
    const model = createFiniteCausalModel(trial.model, { signal });
    if (remainingMs() < 1) return { complete: false, reason: 'model-preparation-deadline', work: finiteCausalModelWork(model) };
    return adapter.replay(adapter.plan({ model, spec: trial.spec }, { signal }), { signal });
  }
  const allowance = remainingMs();
  if (allowance < 1) return { complete: false, reason: 'profile-admission-deadline' };
  return await adapter.evaluate(trial.input, { signal, maxMs: Math.min(250, allowance) });
};

/** Optional report consumer, separated from current search acceptance. The
 * closed adapters operate on finite/saved data only, serially with no retries.
 */
export const evaluateDatasetInterventions = async (input, { signal = null, maxMs = 1000, maxOutputBytes = 1024 * 1024 } = {}) => {
  if (input === null) return null;
  if (!input || !prepared.has(input)) throw fail('Original captured offline intervention input required.');
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000 || !Number.isSafeInteger(maxOutputBytes)
    || maxOutputBytes < 1024 || maxOutputBytes > 1024 * 1024) throw new TypeError('Invalid offline intervention report allowance.');
  const began = performance.now(); throwIfAborted(signal);
  const trials = [], remaining = []; let retainedBytes = 4096, stopped = false;
  for (const entry of input.entries) {
    if (entry.status === 'refused-input') { trials.push(entry); continue; }
    for (const trial of entry.data.trials) {
      throwIfAborted(signal);
      const remainingMs = Math.floor(maxMs - (performance.now() - began));
      if (stopped || remainingMs < 1) { stopped = true; remaining.push({ caseIndex: entry.caseIndex, trialId: trial.id }); continue; }
      const trialBegan = performance.now(); let result;
      try {
        const payload = await execute(trial, signal, Math.min(250, remainingMs));
        throwIfAborted(signal);
        result = { caseIndex: entry.caseIndex, trialId: trial.id, profile: trial.profile,
          status: payload.complete === false ? 'partial-profile-result' : 'evaluated', payload, elapsedMs: performance.now() - trialBegan };
      } catch (error) {
        throwIfAborted(signal);
        if (typeof error?.code !== 'string' || !/^(ERR_FINITE_CAUSAL_|ERR_FINITE_MODEL_INTERVENTION_|ERR_ORIGIN_OBSERVATION_|ERR_TASK_SPAN_TRACE|ERR_ANSWER_)/.test(error.code)) throw error;
        result = { caseIndex: entry.caseIndex, trialId: trial.id, profile: trial.profile, status: 'profile-refused',
          code: error.code, reason: error.message, elapsedMs: performance.now() - trialBegan };
      }
      const bytes = Buffer.byteLength(JSON.stringify(result)) + 1;
      if (retainedBytes + bytes > maxOutputBytes) {
        stopped = true; remaining.push({ caseIndex: entry.caseIndex, trialId: trial.id, reason: 'evaluated-result-exceeds-output-budget',
          workElapsedMs: result.elapsedMs }); continue;
      }
      retainedBytes += bytes; trials.push(result);
    }
  }
  const result = { schemaVersion: 1, kind: 'offline-intervention-evaluation', inputId: input.inputId,
    complete: !remaining.length && trials.every(row => row.status === 'evaluated'),
    currentSearchEvidence: false, aggregation: 'separate-from-live-retrieval-quality-and-policy-qualification', trials, remaining,
    summary: { suppliedTrials: input.trialCount, evaluatedTrials: trials.filter(row => row.status === 'evaluated').length,
      refusedInputs: trials.filter(row => row.status === 'refused-input').length, refusedProfiles: trials.filter(row => row.status === 'profile-refused').length,
      partialProfiles: trials.filter(row => row.status === 'partial-profile-result').length, unreportedTrials: remaining.length },
    taskOutcome: 'not-assessed', policyQualification: 'not-established', decision: null,
    work: { elapsedMs: performance.now() - began, inputPreparationMs: input.preparationMs, retainedInputBytes: input.inputBytes } };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxOutputBytes) throw Object.assign(new Error('Offline intervention report envelope exceeds its output allowance.'), { code: 'ERR_EVAL_INTERVENTION_OUTPUT_LIMIT' });
  throwIfAborted(signal); return immutable(result);
};
