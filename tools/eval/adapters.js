const loaded = new Map();
const loaders = {
  'finite-lookup-v1': async () => {
    const owner = await import('../../src/graph/hypotheses/paired-intervention.js');
    return Object.freeze({ id: 'finite-lookup-v1', executionClass: 'supplied-finite-model-only',
      capabilities: Object.freeze(['plan', 'replay', 'inspect']), plan: owner.planFiniteModelIntervention,
      replay: owner.replayFiniteModelIntervention, inspect: owner.readFiniteModelIntervention });
  },
  'origin-observation-v1': async () => {
    const owner = await import('../../src/retrieval/evaluation/origin-observation.js');
    return Object.freeze({ id: 'origin-observation-v1', executionClass: 'supplied-origin-and-telemetry-metadata-only',
      capabilities: Object.freeze(['evaluate', 'compare']), evaluate: owner.evaluateOriginObservations, compare: owner.compareOriginObservations });
  },
  'retained-answer-integrity-v1': async () => {
    const owner = await import('../../src/retrieval/evaluation/answer-integrity.js');
    return Object.freeze({ id: 'retained-answer-integrity-v1', executionClass: 'supplied-historical-report-integrity-only',
      capabilities: Object.freeze(['evaluate']), evaluate: owner.evaluateAnswerIntegrityAttacks });
  },
  'finite-source-evidence-v1': async () => {
    const [compiler, split, view, baseline, scoring] = await Promise.all([
      import('../../src/retrieval/evaluation/tasks/compiler.js'), import('../../src/retrieval/evaluation/tasks/splits.js'),
      import('../../src/retrieval/evaluation/tasks/candidate-view.js'), import('../../src/retrieval/evaluation/tasks/baseline.js'),
      import('../../src/retrieval/evaluation/tasks/score.js')
    ]);
    return Object.freeze({ id: 'finite-source-evidence-v1', executionClass: 'read-only-compiled-visible-source-only',
      capabilities: Object.freeze(['compile', 'inspectCompilation', 'assignSplits', 'materialize', 'candidatePacket', 'readSource', 'runCandidate', 'score', 'dispose', 'disposeTask']),
      compile: compiler.compileEvidenceTask, inspectCompilation: compiler.inspectEvidenceTaskCompilation, assignSplits: split.assignEvidenceTaskSplits,
      materialize: view.materializeEvidenceTaskView, candidatePacket: view.projectEvidenceTaskView,
      readSource: view.readEvidenceTaskViewSource, runCandidate: baseline.runVisibleEvidenceBaseline,
      score: scoring.scoreEvidenceTask, dispose: view.disposeEvidenceTaskView, disposeTask: compiler.disposeEvidenceTask });
  }
};

/** Explicit closed offline profiles. Load only the selected owner; no provider,
 * command callback or fallback executor is admitted by a benchmark record.
 */
export const getOfflineEvaluationAdapter = async id => {
  if (typeof id !== 'string' || !Object.hasOwn(loaders, id)) throw Object.assign(new Error('Unsupported offline evaluation adapter: ' + (typeof id === 'string' ? id.slice(0, 256) : '<non-string>')), { code: 'ERR_INTERVENTION_ADAPTER_UNAVAILABLE' });
  if (!loaded.has(id)) loaded.set(id, loaders[id]().catch(error => { loaded.delete(id); throw error; }));
  return loaded.get(id);
};
