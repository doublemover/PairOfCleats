import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { applyPositiveRuleSupportDelta, describePositiveRuleView, positiveRuleSupportId, positiveRuleViewWork,
  readPositiveRuleModelInput } from '../../index/semantic/views/positive-rules.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { throwIfAborted } from '../../shared/abort.js';
import { POSITIVE_RULE_REPAIR_SCHEMAS, POSITIVE_RULE_REPAIR_VERSION } from '../../contracts/schemas/positive-rule-repair.js';
import { assertPositiveRuleRepair } from '../../contracts/validators/positive-rule-repair.js';

const owned = new WeakMap();
const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_POSITIVE_RULE_REPAIR_' + suffix });
const key = value => canonicalSemanticJson(value, { maxBytes: 1024 * 1024 });
const hash = value => semanticHash('positive-rule.repair.v' + POSITIVE_RULE_REPAIR_VERSION, value, { maxBytes: 1024 * 1024 });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const capture = (kind, input) => {
  const result = captureSemanticRequest(input, POSITIVE_RULE_REPAIR_SCHEMAS[kind]);
  assertPositiveRuleRepair(kind, result); key(result); return result;
};
const get = handle => {
  const state = handle && typeof handle === 'object' ? owned.get(handle) : null;
  if (!state) throw fail('HANDLE', 'Original finite repair problem required.'); return state;
};
const replay = (state, reverted, signal) => {
  const active = state.request.proposedEdits.filter(edit => !reverted.has(edit.id));
  return applyPositiveRuleSupportDelta(state.baseline, { expectedRootId: state.baseline.rootId,
    removeSupportIds: active.filter(edit => edit.kind === 'remove-support').map(edit => edit.supportId),
    addSupports: active.filter(edit => edit.kind === 'add-support').map(edit => edit.support) }, { signal });
};

/** Inert, finite rollback domain. Every proposal is replayed from the original
 * support set; unchanged Boolean facts are never frozen as independent leaves.
 */
export const createPositiveRuleRepairProblem = ({ baseline, request }, { signal = null } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  const input = readPositiveRuleModelInput(baseline); request = capture('problem', request);
  if (request.expectedBaselineRootId !== baseline.rootId) throw fail('BASE_MISMATCH', 'Repair baseline differs from the exact pinned view.');
  const facts = new Set(input.definition.facts.map(fact => fact.id));
  if (request.forbiddenFacts.some(id => !facts.has(id)) || request.preservedFacts.some(id => !facts.has(id))
    || request.forbiddenFacts.some(id => request.preservedFacts.includes(id))) throw fail('CONTRACT', 'Repair outcome constraints are missing or contradictory.');
  const supports = new Map(input.supports.map(support => [positiveRuleSupportId(support), support]));
  const touched = new Set(), ids = new Set();
  for (const edit of request.proposedEdits) {
    const target = edit.kind === 'add-support' ? positiveRuleSupportId(edit.support) : edit.supportId;
    if (ids.has(edit.id) || touched.has(target) || (edit.kind === 'add-support' ? supports.has(target) : !supports.has(target))) {
      throw fail('CONTRACT', 'Atomic edits must name unique identities and independently valid support changes.');
    }
    ids.add(edit.id); touched.add(target);
  }
  const actions = request.proposedEdits.filter(edit => edit.revertAllowed).sort((a, b) => order(a.id, b.id));
  const state = { baseline, request, actions, worldRef: input.worldRef };
  const proposed = replay(state, new Set(), signal);
  const problemId = hash({ baselineRootId: baseline.rootId, request });
  state.report = immutable({ schemaVersion: POSITIVE_RULE_REPAIR_VERSION, kind: 'finite-positive-rule-repair-problem', problemId,
    baselineRootId: baseline.rootId, proposedRootId: proposed.nextRootId, worldRef: input.worldRef, context: request.context,
    admissibleRevertIds: actions.map(edit => edit.id), candidateCount: 2 ** actions.length, objective: request.objective,
    truthChangedFacts: proposed.truthChanges.map(change => change.factId), producerChangedFacts: proposed.producerChanges.map(change => change.factId),
    forbiddenFacts: request.forbiddenFacts, preservedFacts: request.preservedFacts, execution: 'none', programSemantics: 'not-established' });
  // Conservative logical charge includes the baseline's <=8 MiB prepared
  // producer relation, bounded report/input copies, maps and request. No reader,
  // file handle, native scope, candidate view or response survives in a cursor.
  state.preparation = Object.freeze({ elapsedMs: performance.now() - began, baselineWork: positiveRuleViewWork(baseline), proposedReplay: positiveRuleViewWork(proposed.view),
    accounting: 'baseline-construction-reported-by-caller; problem-capture-hash-and-proposed-replay-included' });
  const handle = Object.freeze({ problemId, baselineRootId: baseline.rootId, version: POSITIVE_RULE_REPAIR_VERSION });
  owned.set(handle, state); throwIfAborted(signal); return handle;
};
export const POSITIVE_REPAIR_RETENTION_BYTES = 20 * 1024 * 1024;
export const describePositiveRuleRepair = handle => get(handle).report;
export const positiveRuleRepairPreparation = handle => get(handle).preparation;

/** Complete candidate validation is independent of the search's optimality.
 * This receipt is a declared-model replay, never an applied source-code repair.
 */
export const replayPositiveRuleRepair = (handle, input, { signal = null } = {}) => {
  const began = performance.now(), state = get(handle); throwIfAborted(signal);
  input = capture('candidate', input);
  if (input.problemId !== handle.problemId) throw fail('BASE_MISMATCH', 'Repair candidate belongs to another problem, task or constraint set.');
  const permitted = new Map(state.actions.map(edit => [edit.id, edit])), reverted = new Set(input.revertEditIds);
  if ([...reverted].some(id => !permitted.has(id))) throw fail('CONTRACT', 'Candidate reverts a missing or inadmissible action.');
  const checked = replay(state, reverted, signal), report = describePositiveRuleView(checked.view);
  const present = new Set(report.facts.filter(fact => fact.present).map(fact => fact.id));
  const checks = [...state.request.forbiddenFacts.map(factId => ({ factId, requiredPresent: false, actualPresent: present.has(factId) })),
    ...state.request.preservedFacts.map(factId => ({ factId, requiredPresent: true, actualPresent: present.has(factId) }))];
  const revertEditIds = [...reverted].sort(order), score = { cardinality: reverted.size,
    userCost: revertEditIds.reduce((sum, id) => sum + permitted.get(id).userCost, 0) };
  const result = { schemaVersion: POSITIVE_RULE_REPAIR_VERSION, kind: 'finite-positive-rule-repair-replay', problemId: handle.problemId,
    baselineRootId: handle.baselineRootId, candidateRootId: checked.nextRootId, worldRef: state.worldRef, context: state.request.context,
    revertEditIds, score, checks, valid: checks.every(check => check.requiredPresent === check.actualPresent),
    completeness: 'complete-in-declared-positive-model', optimality: 'not-assessed', execution: 'none', programSemantics: 'not-established',
    work: { ...positiveRuleViewWork(checked.view), elapsedMs: performance.now() - began } };
  throwIfAborted(signal); return immutable(result);
};

export const comparePositiveRepairScores = (a, b) => a.score.cardinality - b.score.cardinality || a.score.userCost - b.score.userCost
  || order(a.revertEditIds.join('\0'), b.revertEditIds.join('\0'));
