import { runBranchFilterGate } from './branch-gate.js';
import { buildQueryPlanInput } from './plan-input.js';
import { resolveRunSearchDictionaryAndPlan } from './query-planning.js';

/**
 * Run branch gate and query-plan bootstrap for run-search.
 *
 * @param {object} [input]
 * @param {object} input.branchGateInput
 * @param {object} input.planInputConfig
 * @param {object} input.planResolutionInput
 * @param {{
 *   runBranchFilterGate?:(input:object)=>Promise<object|null>,
 *   buildQueryPlanInput?:(input:object)=>object,
 *   resolveRunSearchDictionaryAndPlan?:(input:object)=>Promise<{queryPlan:object,planIndexSignaturePayload:object|null}>
 * }} [input.dependencies]
 * @returns {Promise<{branchGatePayload:object|null,queryPlan?:object,planIndexSignaturePayload?:object|null}>}
 */
export async function resolveRunSearchQueryBootstrap({
  branchGateInput = {},
  planInputConfig = {},
  planResolutionInput = {},
  dependencies = {}
} = {}) {
  const runBranchFilterGateImpl = dependencies.runBranchFilterGate || runBranchFilterGate;
  const buildQueryPlanInputImpl = dependencies.buildQueryPlanInput || buildQueryPlanInput;
  const resolveRunSearchDictionaryAndPlanImpl = (
    dependencies.resolveRunSearchDictionaryAndPlan || resolveRunSearchDictionaryAndPlan
  );

  const branchGatePayload = await runBranchFilterGateImpl(branchGateInput);
  if (branchGatePayload) {
    return { branchGatePayload };
  }

  const planInput = buildQueryPlanInputImpl(planInputConfig);
  const {
    queryPlan,
    planIndexSignaturePayload
  } = await resolveRunSearchDictionaryAndPlanImpl({
    ...planResolutionInput,
    planInput
  });
  return {
    branchGatePayload: null,
    queryPlan,
    planIndexSignaturePayload
  };
}
