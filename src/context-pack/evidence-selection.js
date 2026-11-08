import { createWorkBudget } from '../graph/work-budget.js';
import { throwIfAborted } from '../shared/abort.js';
import { renderCompositeContextPack } from '../retrieval/output/composite-context-pack.js';
import { withRenderedContextTokenCounter } from './token-counter.js';
import { finalizeRenderedTokenBudget } from './rendered-token-budget.js';
import { buildContextEvidenceCandidatePool } from './evidence-candidate-pool.js';
import { selectContextEvidenceSet } from './evidence-set-selector.js';
import { evidenceSelectionPolicyDigest } from './evidence-selection-policy.js';
import { CONTEXT_EVIDENCE_ROLES, contextEvidencePoolDigest } from '../contracts/context-evidence-selection.js';
import { CONTEXT_EVIDENCE_SELECTOR_VERSION, CONTEXT_EVIDENCE_ROLE_VERSION,
  CONTEXT_EVIDENCE_SIMILARITY_VERSION } from '../contracts/schemas/context-evidence-selection.js';
import { CONTEXT_PACK_RESPONSE_MAX_BYTES } from './response-budget.js';

const emptyCoverage = () => ({ meaning: 'heuristic-graph-incidence', available: [], selected: [], missing: [], unknownRoleIds: [] });
const emptySimilarity = () => ({ meaning: 'lexical-prefix-jaccard', maxChars: 4096, maxTerms: 128, emptyIds: [], unavailableIds: [] });
const sourceOmission = row => row.status === 'omitted' && row.reason !== 'mandatory-primary';
export const CONTEXT_EVIDENCE_CONTROLS = Object.freeze(['top-k', 'mmr', 'role-coverage', 'facility-location']);

/** Run one control against a shared, frozen source pool. Each control retains
 * its own exact render history and cooperative selection allowance. */
const runEvidenceControl = async ({ payload, chunkIndex, repoRoot, taskPolicy, policy, tokenPolicy, counter, source }) => {
  const started = performance.now(), memoryBefore = process.memoryUsage();
  const initialSection = { schemaVersion: 1, selectorVersion: CONTEXT_EVIDENCE_SELECTOR_VERSION,
    roleVersion: CONTEXT_EVIDENCE_ROLE_VERSION, similarityVersion: CONTEXT_EVIDENCE_SIMILARITY_VERSION,
    policy, policyDigest: evidenceSelectionPolicyDigest(policy), poolDigest: '0'.repeat(64), partial: false,
    stopReason: null, selected: [], decisions: [], coverage: emptyCoverage(), similarity: emptySimilarity(),
    stats: { observed: 0, admitted: 0, omittedBeyondPool: 0, poolBytes: 0, workUnits: 0, pairwise: 0, measurements: 1 } };
  const withSection = section => ({ ...payload, evidenceSelection: section,
    evidence: { ...payload.evidence, complete: payload.evidence.complete === true && !section.partial
      && !section.coverage.missing.length && !section.coverage.unknownRoleIds.length,
    selection: { included: true, state: section.partial ? 'partial' : 'selected', heuristic: true } } });
  const measure = async (selected, section = initialSection) => {
    throwIfAborted(counter.signal);
    const candidate = withSection({ ...section, selected });
    const renderedContext = renderCompositeContextPack(candidate) + '\n';
    if (Buffer.byteLength(renderedContext) > CONTEXT_PACK_RESPONSE_MAX_BYTES) return {
      fits: false, tokens: null, reason: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' };
    const counted = await counter.count(renderedContext);
    try {
      finalizeRenderedTokenBudget(candidate, tokenPolicy, counted, renderedContext);
      return { fits: true, tokens: counted.tokens, publish: counted.publish, renderedContext };
    } catch (error) {
      if (!['ERR_CONTEXT_PACK_TOKEN_BUDGET', 'ERR_CONTEXT_PACK_RESPONSE_BUDGET'].includes(error.code)) throw error;
      return { fits: false, tokens: counted.tokens, reason: error.code, error };
    }
  };
  const initial = await measure([]);
  if (!initial.fits) throw initial.error || Object.assign(new Error('Mandatory context exceeds its complete response byte budget.'), {
    code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET', status: 413
  });
  // The optional phase begins after the mandatory exact envelope. Charge each
  // comparison for the original source work/time, without re-reading sources.
  const phaseStarted = performance.now();
  let sourceTimeCharge = 0;
  const budget = createWorkBudget({ maxWorkUnits: policy.maxWorkUnits, maxWallClockMs: policy.maxWallClockMs,
    checkEvery: 1, now: () => performance.now() + sourceTimeCharge });
  if (!source.pool) {
    source.pool = buildContextEvidenceCandidatePool({ payload, chunkIndex, repoRoot, taskPolicy, policy, budget, signal: counter.signal });
    source.work = budget.getUsed(); source.elapsedMs = performance.now() - phaseStarted;
  } else {
    sourceTimeCharge = source.elapsedMs;
    if (source.work) budget.consume(source.work);
  }
  const pool = source.pool;
  const result = await selectContextEvidenceSet({ pool, policy, budget, initial, signal: counter.signal,
    measure: selected => measure(selected, { ...initialSection, poolDigest: pool.digest, decisions: pool.decisions,
      stats: { ...initialSection.stats, observed: pool.observed, admitted: pool.candidates.length,
        omittedBeyondPool: pool.omittedBeyondPool, poolBytes: pool.bytes } }) });
  let selected = result.selected.slice(), decisions = result.decisions;
  let stopReason = result.stopReason;
  if (!stopReason && decisions.some(row => row.reason === 'ERR_CONTEXT_PACK_TOKEN_BUDGET' || row.reason === 'ERR_CONTEXT_PACK_RESPONSE_BUDGET')) stopReason = 'budget-fit';
  const partial = () => Boolean(pool.omittedBeyondPool || decisions.some(sourceOmission)
    || stopReason && stopReason !== 'objective-saturated');
  for (;;) {
    throwIfAborted(counter.signal);
    const covered = CONTEXT_EVIDENCE_ROLES.filter(role => selected.some(entry => entry.roles.includes(role)));
    const section = { ...initialSection, selected, decisions, stopReason, partial: partial(),
      coverage: { ...result.coverage, selected: covered, missing: result.coverage.available.filter(role => !covered.includes(role)) },
      similarity: result.similarity,
      stats: { observed: pool.observed, admitted: pool.candidates.length, omittedBeyondPool: pool.omittedBeyondPool,
        poolBytes: pool.bytes, workUnits: budget.getUsed(), ...result.stats } };
    section.poolDigest = contextEvidencePoolDigest({ indexSignature: payload.provenance.indexSignature, decisions, observed: pool.observed });
    const exact = result.history[selected.length];
    try {
      const counted = finalizeRenderedTokenBudget(withSection(section), tokenPolicy,
        { tokens: exact.tokens, publish: exact.publish }, exact.renderedContext);
      return { ...counted, observation: { elapsedMs: performance.now() - started,
        memoryBefore, memoryAfter: process.memoryUsage(), sourceWorkUnits: source.work, sourceElapsedMs: source.elapsedMs } };
    } catch (error) {
      if (error.code !== 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' || !selected.length) throw error;
      const removed = selected.at(-1);
      selected = selected.slice(0, -1); stopReason = 'final-response-byte-cap';
      decisions = decisions.map(row => row.id === removed.id ? { ...row, status: 'deferred', reason: stopReason } : row);
    }
  }
};

/** Single-repository prototype. All variants retain the mandatory primary,
 * qualify one common pool and use the same exact final-render/byte admission. */
export const applyContextEvidenceSelection = async options => {
  const { repoRoot, taskPolicy, policy, tokenPolicy, signal, timeoutMs = 10000, compareControls = false } = options;
  if (options.chunkIndex.ambiguousChunkUids?.has(options.payload.primary.ref?.chunkUid)) throw Object.assign(
    new Error('Evidence selection requires an unambiguous mandatory chunk identity.'), { code: 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE', status: 400 });
  if (compareControls && policy.maxMeasurements > 32) throw Object.assign(new Error('Four-control evaluation requires maxMeasurements at most 32 per control.'), {
    code: 'ERR_CONTEXT_PACK_INVALID_REQUEST', status: 400
  });
  return withRenderedContextTokenCounter({ policy: tokenPolicy, repoRoot, signal, timeoutMs,
    taskPolicy: { taskPolicy, selectorVersion: CONTEXT_EVIDENCE_SELECTOR_VERSION, roleVersion: CONTEXT_EVIDENCE_ROLE_VERSION,
      similarityVersion: CONTEXT_EVIDENCE_SIMILARITY_VERSION, selection: policy, compareControls } }, async counter => {
    const source = { pool: null, work: 0, elapsedMs: 0 };
    const run = policy => runEvidenceControl({ ...options, policy, counter, source });
    const first = await run(policy);
    if (!compareControls) return first;
    const controls = [first];
    for (const algorithm of CONTEXT_EVIDENCE_CONTROLS) {
      if (algorithm !== policy.algorithm) controls.push(await run(Object.freeze({ ...policy, algorithm })));
    }
    return { ...first, comparison: controls.map(row => ({ payload: row.payload, observation: row.observation })),
      publish: () => { for (const row of controls) row.publish(); } };
  });
};
