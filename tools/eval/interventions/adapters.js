const loaded = new Map();
const loaders = {
  'finite-lookup-v1': async () => {
    const owner = await import('../../../src/graph/hypotheses/paired-intervention.js');
    return Object.freeze({ id: 'finite-lookup-v1', executionClass: 'supplied-finite-model-only',
      capabilities: Object.freeze(['plan', 'replay', 'inspect']), plan: owner.planFiniteModelIntervention,
      replay: owner.replayFiniteModelIntervention, inspect: owner.readFiniteModelIntervention });
  },
  'origin-observation-v1': async () => {
    const owner = await import('../../../src/retrieval/evaluation/origin-observation.js');
    return Object.freeze({ id: 'origin-observation-v1', executionClass: 'supplied-origin-and-telemetry-metadata-only',
      capabilities: Object.freeze(['evaluate', 'compare']), evaluate: owner.evaluateOriginObservations, compare: owner.compareOriginObservations });
  }
};

/** Explicit offline adapter selection. No provider/command callbacks, source
 * mutation or fallback from an unsupported execution profile are admitted.
 */
export const getInterventionAdapter = async id => {
  if (typeof id !== 'string' || !Object.hasOwn(loaders, id)) throw Object.assign(new Error('Unsupported offline intervention adapter: ' + (typeof id === 'string' ? id.slice(0, 256) : '<non-string>')), { code: 'ERR_INTERVENTION_ADAPTER_UNAVAILABLE' });
  if (!loaded.has(id)) loaded.set(id, loaders[id]().catch(error => { loaded.delete(id); throw error; }));
  return loaded.get(id);
};
