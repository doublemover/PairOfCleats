import { readEvaluationData } from '../eval/passive-evidence.js';
import { selectRetrievalCohort } from './retrieval-cohort-admission.js';
export { selectRetrievalCohort, RETRIEVAL_COHORT_FIELDS } from './retrieval-cohort-admission.js';
import { captureEvaluationHit } from '../eval/hit-evidence.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';

const invalidResponse = message => Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_RESPONSE' });

const captureComparisonHit = hit => {
  const captured = { ...captureEvaluationHit(hit) };
  for (const key of ['score', 'sparseScore', 'annScore']) {
    const field = readEvaluationData(hit, key, invalidResponse);
    if (!field.present || field.value == null) continue;
    if (typeof field.value !== 'number' || !Number.isFinite(field.value)) throw invalidResponse(`Invalid comparison ${key} measurement.`);
    captured[key] = field.value;
  }
  const type = readEvaluationData(hit, 'scoreType', invalidResponse);
  if (type.present && type.value != null) {
    if (typeof type.value !== 'string' || !type.value || type.value.length > 128) throw invalidResponse('Invalid comparison score type.');
    captured.scoreType = type.value;
  }
  const breakdown = readEvaluationData(hit, 'scoreBreakdown', invalidResponse);
  if (breakdown.present && breakdown.value != null) {
    if (typeof breakdown.value !== 'object' || Array.isArray(breakdown.value)) throw invalidResponse('Invalid comparison score breakdown.');
    const selected = readEvaluationData(breakdown.value, 'selected', invalidResponse).value;
    if (selected != null) {
      if (typeof selected !== 'object' || Array.isArray(selected)) throw invalidResponse('Invalid comparison selected score.');
      const score = readEvaluationData(selected, 'score', invalidResponse).value;
      if (score != null && (typeof score !== 'number' || !Number.isFinite(score))) throw invalidResponse('Invalid comparison selected score.');
      captured.scoreBreakdown = Object.freeze({ selected: Object.freeze({ score: score ?? null }) });
    }
  }
  return Object.freeze(captured);
};

/** Keep execution qualification separate from admitted hit arrays. An observed
 * fallback can retain descriptive ranks without certifying the requested arm. */
export const admitComparisonResponse = (payload, modes, { registry, expectedBackend = null } = {}) => {
  const cohorts = {}, failures = {};
  for (const mode of modes) {
    try { cohorts[mode] = Object.freeze(selectRetrievalCohort(payload, mode).map(captureComparisonHit)); }
    catch (error) {
      const observation = observeStorageResource(error, { phase: 'comparison-response-admission' });
      observation.requireSettled();
      let code, message;
      try { code = error?.code; message = error?.message; }
      catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
      observation.requireSettled();
      if (!['ERR_RETRIEVAL_RESPONSE', 'ERR_EVAL_HIT_IDENTITY'].includes(code)) throw error;
      cohorts[mode] = null; failures[mode] = { code, message };
    }
  }
  const execution = registry.observe(payload, modes), receipt = registry.receipt(execution.ref);
  const reasons = [...execution.reasons];
  const expected = expectedBackend === 'fts' || expectedBackend === 'sqlite-fts' ? 'sqlite' : expectedBackend;
  const selected = receipt?.backend.selected === 'sqlite-fts' ? 'sqlite' : receipt?.backend.selected;
  if (expected && expected !== 'auto' && selected !== expected) reasons.push('observed-backend-mismatch');
  const byMode = Object.fromEntries(modes.map(mode => {
    const local = [...reasons];
    if (failures[mode]) local.push(failures[mode].code);
    if (['fts', 'sqlite-fts'].includes(expectedBackend) && cohorts[mode]?.length > 0
      && receipt?.execution[mode]?.effective.sparse !== 'fts') local.push('observed-fts-route-unqualified');
    return [mode, { state: failures[mode] ? 'unavailable' : 'available', qualified: local.length === 0,
      reasons: local, ...(failures[mode] ? { message: failures[mode].message } : {}) }];
  }));
  return { cohorts: Object.freeze(cohorts), receipt, admission: {
    state: Object.keys(failures).length ? 'unavailable' : 'available', qualified: modes.every(mode => byMode[mode].qualified),
    reasons: [...new Set(Object.values(byMode).flatMap(value => value.reasons))], execution: execution.ref, byMode } };
};
