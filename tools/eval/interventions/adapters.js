import { planFiniteModelIntervention, replayFiniteModelIntervention, readFiniteModelIntervention } from '../../../src/graph/hypotheses/paired-intervention.js';

const finite = Object.freeze({ id: 'finite-lookup-v1', executionClass: 'supplied-finite-model-only',
  plan: planFiniteModelIntervention, replay: replayFiniteModelIntervention, inspect: readFiniteModelIntervention });

/** Explicit offline adapter selection. No provider/command callbacks, source
 * mutation or fallback from an unsupported execution profile are admitted.
 */
export const getInterventionAdapter = id => {
  if (id !== finite.id) throw Object.assign(new Error('Unsupported offline intervention adapter: ' + (typeof id === 'string' ? id.slice(0, 256) : '<non-string>')), { code: 'ERR_INTERVENTION_ADAPTER_UNAVAILABLE' });
  return finite;
};
