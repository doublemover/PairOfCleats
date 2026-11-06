import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { readFiniteCausalDiscrimination } from '../../graph/hypotheses/discriminate.js';
import { planInvestigationEvidence } from './controller.js';

/** Bind model advice to the existing read-only next-evidence owner. A planned
 * intervention is inert; only independently owner-admitted reads for a current
 * investigation deficit can cross this seam. No observation/support is added.
 */
export const planInvestigationCausalEvidence = ({ investigation, plan, actions, ...options }) => {
  const { request, sourceWorld } = readFiniteCausalDiscrimination(plan);
  const key = canonicalSemanticJson;
  if (investigation.investigationId !== request.investigationRef.investigationId
    || investigation.projectionRevision !== request.investigationRef.projectionRevision
    || investigation.taskRevision !== request.context.taskRevision || investigation.branchId !== request.context.branchId
    || investigation.assumptionSetId !== request.context.assumptionSetId || key(investigation.afterWorldRef) !== key(sourceWorld)) {
    throw Object.assign(new Error('Causal advice belongs to another investigation revision, branch, assumptions or source world.'), { code: 'ERR_INVESTIGATION_CONFLICT' });
  }
  if (!Array.isArray(actions) || actions.length > 16384) throw new TypeError('Bounded owner-admitted read actions required.');
  const matching = plan.selectedAction ? actions.filter(action => action?.arguments?.causalPlanId === plan.planId
    && action.arguments.causalActionId === plan.selectedAction.actionId) : [];
  return { schemaVersion: 1, causalPlanId: plan.planId, investigationId: investigation.investigationId,
    projectionRevision: investigation.projectionRevision, readAdvice: planInvestigationEvidence({ investigation, actions: matching, ...options }),
    interventionAuthority: 'not-granted-by-model-advice', execution: 'none' };
};
