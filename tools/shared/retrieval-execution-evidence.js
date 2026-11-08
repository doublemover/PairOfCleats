import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../../src/index/semantic/identity.js';
import { isRetrievalExecution } from '../../src/contracts/retrieval-execution.js';
import { readEvaluationData } from '../eval/passive-evidence.js';

export const RETRIEVAL_EVIDENCE_VERSION = 2;
const fail = message => Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_EVIDENCE' });
const own = (value, key) => value && typeof value === 'object' && !Array.isArray(value)
  ? readEvaluationData(value, key, fail).value : undefined;
const text = (value, maximum = 512) => typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
const bool = value => typeof value === 'boolean' ? value : null;
const snapshot = value => JSON.parse(canonicalSemanticJson(value, { maxBytes: 8192 }));
const modeField = mode => mode === 'extracted-prose' ? 'extractedProse' : mode;
const freezeData = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeData(child); Object.freeze(value); }
  return value;
};

/** Compact passive observations, never a claim inferred from requested flags
 * or native installation. Unknown evidence preserves descriptive results. */
export const captureRetrievalExecutionEvidence = (payload, modes) => {
  if (!Array.isArray(modes) || !modes.length || modes.length > 4 || new Set(modes).size !== modes.length
    || modes.some(mode => !['code', 'prose', 'extracted-prose', 'records'].includes(mode))) throw fail('A canonical selected cohort plan is required.');
  const metadata = own(payload, 'retrieval'), backend = own(metadata, 'backend'), fidelity = own(metadata, 'fidelity');
  const freshness = own(metadata, 'freshness'), byMode = own(freshness, 'byMode');
  const outcomes = own(fidelity, 'byMode'), cache = own(metadata, 'cache');
  const selected = text(own(backend, 'selected')), rawPolicy = text(own(metadata, 'effectivePlanIdentity'), 128);
  const policy = rawPolicy && /^eqp1-[a-f0-9]{64}$/.test(rawPolicy) ? rawPolicy : null;
  const rawSystem = text(own(metadata, 'effectiveSystemIdentity'), 128);
  const systemPolicy = rawSystem && /^esp1-[a-f0-9]{64}$/.test(rawSystem) ? rawSystem : null;
  const reasons = new Set();
  if (!systemPolicy) reasons.add('effective-system-policy-missing');
  if (!selected) reasons.add('observed-backend-missing');
  if (!policy) reasons.add('effective-policy-missing');
  const fallbackDerived = bool(own(fidelity, 'fallbackDerived'));
  const fidelityStatus = text(own(fidelity, 'status'));
  if (fallbackDerived !== false || fidelityStatus !== 'complete' || own(backend, 'availabilityDriven') !== false) reasons.add('fallback-or-fidelity-unqualified');
  const generations = {}, execution = {}, modeKeys = {};
  for (const mode of modes) {
    const source = own(byMode, modeField(mode));
    const signature = own(source, 'signature');
    const generation = { buildId: text(own(source, 'buildId')), artifactSurfaceVersion: text(own(source, 'artifactSurfaceVersion')),
      generationKey: text(own(source, 'generationKey'),4096), activeBuildRoot: text(own(source, 'activeBuildRoot'), 2048),
      profileId: text(own(source, 'profileId')), signatureHash: signature == null ? null
        : semanticHash('retrieval-mode-signature.v1', signature, { maxBytes: 8192 }) };
    generations[mode] = generation;
    if (!generation.buildId || !generation.artifactSurfaceVersion || !generation.profileId || !generation.signatureHash) {
      reasons.add('source-generation-unqualified');
    }
    const original = own(outcomes, mode);
    const outcome = original == null ? null : snapshot(original);
    if (!isRetrievalExecution(outcome, mode) || outcome.status !== 'complete') reasons.add('mode-execution-unqualified');
    execution[mode] = outcome && isRetrievalExecution(outcome, mode) ? outcome : null;
    modeKeys[mode] = semanticHash('retrieval-observed-system.v2', { selected, policy: systemPolicy, generation });
  }
  return freezeData(snapshot({ schemaVersion: RETRIEVAL_EVIDENCE_VERSION, kind: 'observed-retrieval-execution', modes: [...modes],
    backend: { selected, requested: text(own(backend, 'requested')), selectionKind: text(own(backend, 'selectionKind')),
      selectionReason: text(own(backend, 'selectionReason')), availabilityDriven: bool(own(backend, 'availabilityDriven')) },
    effectivePlanIdentity: policy, effectiveSystemIdentity: systemPolicy, fallbackDerived, fidelityStatus, generations, execution, modeKeys,
    cache: { hit: bool(own(cache, 'hit')), strategy: text(own(cache, 'strategy')), memoryHotPath: bool(own(cache, 'memoryHotPath')) },
    qualification: { state: reasons.size ? 'unqualified' : 'qualified', reasons: [...reasons] } }));
};

/** Intern bounded receipts; consistency state uses one original key and a
 * monotone mixed bit per declared selection/mode, rather than an unbounded set. */
export const createRetrievalEvidenceRegistry = () => {
  const receipts = [], byKey = new Map(), contexts = new Map(), generations = new Map();
  let bytes = 0, observations = 0, qualified = 0, omitted = 0;
  const track = (map, context, key) => {
    const previous = map.get(context);
    if (!previous) map.set(context, { firstKey: key, mixed: false, observations: 1 });
    else { previous.observations++; if (previous.firstKey !== key) previous.mixed = true; }
  };
  return {
    receipt: ref => Number.isSafeInteger(ref) && ref >= 0 ? receipts[ref]?.receipt || null : null,
    observe(payload, modes) {
      const receipt = captureRetrievalExecutionEvidence(payload, modes), encoded = canonicalSemanticJson(receipt, { maxBytes: 8192 });
      const key = semanticHash('retrieval-execution-receipt.v2', receipt, { maxBytes: 8192 });
      observations++;
      for (const mode of modes) {
        track(contexts, `${modes.join(',')}/${mode}`, receipt.modeKeys[mode]);
        track(generations, mode, semanticHash('retrieval-source-generation.v1', receipt.generations[mode]));
      }
      let ref = byKey.get(key);
      if (ref == null) {
        if (receipts.length >= 256 || bytes + Buffer.byteLength(encoded) > 512 * 1024) {
          omitted++;
          return { ref: null, state: 'unqualified', reasons: [...receipt.qualification.reasons, 'execution-receipt-retention-limit'] };
        }
        ref = receipts.length; receipts.push({ key, receipt, observations: 0 }); byKey.set(key, ref); bytes += Buffer.byteLength(encoded);
      }
      receipts[ref].observations++;
      if (receipt.qualification.state === 'qualified') qualified++;
      return { ref, ...receipt.qualification };
    },
    snapshot() {
      const mixed = [...contexts.values(), ...generations.values()].some(row => row.mixed);
      const result = { schemaVersion: RETRIEVAL_EVIDENCE_VERSION, kind: 'retrieval-experiment-evidence', observations,
        qualifiedObservations: qualified, unqualifiedObservations: observations - qualified, omittedReceipts: omitted,
        retainedBytes: bytes, consistency: mixed ? 'mixed' : qualified === observations && observations > 0 ? 'stable' : 'unknown',
        status: !mixed && observations > 0 && qualified === observations ? 'qualified' : 'unqualified',
        contexts: Object.fromEntries(contexts), generations: Object.fromEntries(generations), receipts };
      return JSON.parse(canonicalSemanticJson({ ...result,
        key: semanticHash('retrieval-experiment-evidence.v2', result, { maxBytes: 1024 * 1024 }) }, { maxBytes: 1024 * 1024 }));
    }
  };
};

/** Live input semantics only. Saved oracle/replay artifacts retain their own
 * provenance and are not promoted by this selected-query/judgment identity. */
export const captureLiveEvaluationInput = (cases, plan, limit) => {
  const hash = createHash('sha256').update('live-evaluation-input.v1\0').update(plan.key).update(`\0${limit}\0`);
  const rows = cases.map((entry, index) => {
    const captured = { index, query: entry.query, selection: entry.selection, silver: entry.silver, gold: entry.gold };
    const encoded = canonicalSemanticJson(captured, { maxBytes: 128 * 1024 });
    hash.update(`${Buffer.byteLength(encoded)}:`).update(encoded);
    return { ...entry, caseId: 'ec1:' + semanticHash('live-evaluation-case.v1', captured, { maxBytes: 128 * 1024 }) };
  });
  return { cases: rows, identity: Object.freeze({ schemaVersion: 1, key: 'ei1:' + hash.digest('hex'),
    selectedCases: rows.length, limit, matchMode: plan.matchMode, metricPlanKey: plan.key,
    judgmentPolicy: 'ordered-captured-mode-qualified-silver-and-gold' }) };
};

/** A completed descriptive score is useful, but cannot authorize a strict
 * comparison without one qualified observed experiment and matching input. */
export const assertQualifiedEvaluationComparison = (left, right = left) => {
  const reports = [left, right].map(report => {
    const evidence = own(report, 'executionEvidence'), input = own(report, 'evaluationInput'), plan = own(report, 'evaluationPlan');
    return { executionEvidence: evidence == null ? null : JSON.parse(canonicalSemanticJson(evidence, { maxBytes: 1024 * 1024 })),
      evaluationInput: input == null ? null : snapshot(input), evaluationPlan: plan == null ? null : snapshot(plan) };
  });
  for (const report of reports) {
    if (report?.executionEvidence?.status !== 'qualified' || report.executionEvidence.consistency !== 'stable'
      || !/^ei1:[a-f0-9]{64}$/.test(report?.evaluationInput?.key || '')
      || report.evaluationInput.metricPlanKey !== report.evaluationPlan?.key
      || report.evaluationInput.selectedCases !== report.executionEvidence.observations
      || report.executionEvidence.unqualifiedObservations !== 0 || report.executionEvidence.omittedReceipts !== 0) {
      throw fail('Strict evaluation comparison requires complete, stable observed execution and input qualification.');
    }
    const { key, ...evidence } = report.executionEvidence;
    if (key !== semanticHash('retrieval-experiment-evidence.v2', evidence, { maxBytes: 1024 * 1024 })
      || !Array.isArray(evidence.receipts) || !evidence.receipts.length || evidence.receipts.length > 256
      || evidence.receipts.reduce((total, row) => total + row.observations, 0) !== evidence.observations) {
      throw fail('Observed execution registry is incomplete or changed.');
    }
    const contexts = new Map(), generations = new Map();
    for (const row of evidence.receipts) {
      const receipt = row.receipt;
      if (!Number.isSafeInteger(row.observations) || row.observations < 1
        || row.key !== semanticHash('retrieval-execution-receipt.v2', receipt, { maxBytes: 8192 })
        || receipt.schemaVersion !== RETRIEVAL_EVIDENCE_VERSION || !/^esp1-[a-f0-9]{64}$/.test(receipt.effectiveSystemIdentity || '')
        || receipt.qualification?.state !== 'qualified' || receipt.qualification.reasons.length
        || receipt.fidelityStatus !== 'complete' || receipt.fallbackDerived !== false
        || receipt.backend?.availabilityDriven !== false || !receipt.backend?.selected || !/^eqp1-[a-f0-9]{64}$/.test(receipt.effectivePlanIdentity || '')
        || !receipt.modes?.length || receipt.modes.some(mode => !isRetrievalExecution(receipt.execution?.[mode], mode)
          || receipt.execution[mode].status !== 'complete' || !receipt.generations?.[mode]?.buildId
          || !receipt.generations[mode].artifactSurfaceVersion || !/^[a-f0-9]{64}$/.test(receipt.generations[mode].signatureHash || '')
          || !receipt.generations[mode].profileId)) {
        throw fail('Execution receipt lacks required observed source, policy or route evidence.');
      }
      for (const mode of receipt.modes) {
        const key = semanticHash('retrieval-observed-system.v2', { selected: receipt.backend.selected,
          policy: receipt.effectiveSystemIdentity, generation: receipt.generations[mode] });
        const context = `${receipt.modes.join(',')}/${mode}`;
        const generation = semanticHash('retrieval-source-generation.v1', receipt.generations[mode]);
        if (receipt.modeKeys[mode] !== key || contexts.has(context) && contexts.get(context) !== key
          || generations.has(mode) && generations.get(mode) !== generation) throw fail('Observed evaluation systems or generations changed between cases.');
        contexts.set(context, key); generations.set(mode, generation);
      }
    }
  }
  if (reports[0].evaluationInput.key !== reports[1].evaluationInput.key) throw fail('Selected evaluation queries, judgments or matching policy differ.');
};
