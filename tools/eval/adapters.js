const loaded = new Map();
const loaders = {
  'finite-import-test-suggestion-revisions-v1': async () => {
    const [scenario, owner] = await Promise.all([import('./revisions/suggestion-scenario.js'), import('./revisions/suggestion-runner.js')]);
    return Object.freeze({ id: 'finite-import-test-suggestion-revisions-v1', executionClass: 'supplied-finite-import-supports-real-suggestion-consumer',
      capabilities: Object.freeze(['generate', 'run', 'inspect', 'compareDiagnostic', 'minimize', 'dispose']),
      generate: scenario.generateSuggestionRevisionScenario, run: owner.runSuggestionRevisionScenario, inspect: owner.readSuggestionRevisionRun,
      compareDiagnostic: owner.compareSuggestionRevisionOutput, minimize: owner.minimizeSuggestionRevisionFailure, dispose: owner.retireSuggestionRevisionRun });
  },
  'finite-adjacency-composition-v1': async () => {
    const owner = await import('../../src/index/semantic/views/composition.js');
    return Object.freeze({ id: owner.VIEW_COMPOSITION_PROFILE, executionClass: 'supplied-original-finite-view-dag-only',
      capabilities: Object.freeze(['bootstrap', 'apply', 'inspect', 'input', 'output', 'checkpoint', 'invalidate', 'work']),
      bootstrap: owner.bootstrapViewComposition, apply: owner.applyViewCompositionDelta, inspect: owner.describeViewComposition,
      input: owner.viewCompositionInput, output: owner.viewCompositionOutput, checkpoint: owner.checkpointViewComposition,
      invalidate: owner.invalidateViewComposition, work: owner.viewCompositionWork });
  },
  'typescript-api7-request-snapshot-v1': async () => {
    const [owner, pins, runtime] = await Promise.all([import('../tooling/managed-typescript-api7.js'), import('../../src/shared/typescript-api7-pins.js'),
      import('../../src/index/tooling/typescript/api7/runtime.js')]);
    return Object.freeze({ id: pins.TYPESCRIPT_API7_PROFILE, executionClass: 'explicit-experimental-api7-request-filesystem',
      capabilities: Object.freeze(['prepare', 'run']), prepare: owner.prepareManagedTypeScriptApi7, run: runtime.runTypeScriptApi7Request });
  },
  'published-javascript-chunk-index-revisions-v3': async () => {
    const [scenario, owner] = await Promise.all([import('./revisions/source-scenario.js'), import('./revisions/index-runner.js')]);
    return Object.freeze({ id: owner.INDEX_REVISION_PROFILE, executionClass: 'opt-in-constructed-source-real-stage2-publication',
      capabilities: Object.freeze(['generate', 'run', 'inspect', 'recheck', 'minimize', 'dispose']), generate: scenario.generateSourceRevisionScenario,
      run: owner.runIndexRevisionScenario, inspect: owner.readIndexRevisionRun, recheck: owner.recheckIndexRevisionRun,
      minimize: owner.minimizeIndexRevisionFailure, dispose: owner.retireIndexRevisionRun });
  },
  'tiny-javascript-source-revisions-v1': async () => {
    const [scenario, runner, reference] = await Promise.all([import('./revisions/source-scenario.js'), import('./revisions/source-runner.js'), import('./revisions/source-reference.js')]);
    return Object.freeze({ id: 'tiny-javascript-source-revisions-v1', executionClass: 'constructed-inert-javascript-source-only',
      capabilities: Object.freeze(['generate', 'run', 'inspect', 'compareDiagnostic', 'minimize', 'dispose']),
      generate: scenario.generateSourceRevisionScenario, run: runner.runSourceRevisionScenario, inspect: runner.readSourceRevisionRun,
      compareDiagnostic: reference.compareSourceRevisionOutput, minimize: runner.minimizeSourceRevisionFailure, dispose: runner.retireSourceRevisionRun });
  },
  'finite-selected-adjacency-v1': async () => {
    const owner = await import('../../src/index/semantic/views/selected-adjacency.js');
    return Object.freeze({ id: 'finite-selected-adjacency-v1', executionClass: 'supplied-original-adjacency-view-only',
      capabilities: Object.freeze(['bootstrap', 'apply', 'inspect', 'work']), bootstrap: owner.bootstrapSelectedAdjacency,
      apply: owner.applySelectedAdjacencyDelta, inspect: owner.describeSelectedAdjacency, work: owner.selectedAdjacencyWork });
  },
  'finite-grouped-adjacency-v1': async () => {
    const owner = await import('../../src/index/semantic/views/grouped-adjacency.js');
    return Object.freeze({ id: 'finite-grouped-adjacency-v1', executionClass: 'supplied-original-adjacency-view-only',
      capabilities: Object.freeze(['bootstrap', 'apply', 'inspect', 'work']), bootstrap: owner.bootstrapGroupedAdjacency,
      apply: owner.applyGroupedAdjacencyDelta, inspect: owner.describeGroupedAdjacency, work: owner.groupedAdjacencyWork });
  },
  'finite-relational-revisions-v3': async () => {
    const owner = await import('./revisions/relational.js');
    return Object.freeze({ id: owner.REVISION_RELATIONAL_PROFILE, executionClass: 'tiny-supplied-relational-revisions-only',
      capabilities: Object.freeze(['generate', 'run', 'inspect', 'compareDiagnostic', 'minimize', 'dispose']),
      generate: owner.generateRelationalRevisionScenario, run: owner.runRelationalRevisionScenario, inspect: owner.readRelationalRevisionRun,
      compareDiagnostic: owner.compareRelationalRevisionOutput, minimize: owner.minimizeRelationalRevisionFailure, dispose: owner.retireRelationalRevisionRun });
  },
  'finite-positive-support-revisions-v1': async () => {
    const [scenario, runner, reference] = await Promise.all([import('./revisions/scenario.js'), import('./revisions/runner.js'), import('./revisions/reference.js')]);
    return Object.freeze({ id: 'finite-positive-support-revisions-v1', executionClass: 'supplied-finite-model-revisions-only',
      capabilities: Object.freeze(['generate', 'run', 'inspect', 'compareDiagnostic', 'minimize', 'dispose']),
      generate: scenario.generateRevisionScenario, run: runner.runRevisionScenario, inspect: runner.readRevisionRun,
      compareDiagnostic: reference.compareRevisionOutputs, minimize: runner.minimizeRevisionFailure, dispose: runner.retireRevisionRun });
  },
  'finite-boolean-acyclic-v1': async () => {
    const owner = await import('../../src/semantic/finite-feasibility.js');
    return Object.freeze({ id: 'finite-boolean-acyclic-v1', executionClass: 'supplied-finite-boolean-model-only',
      capabilities: Object.freeze(['createTarget', 'refine', 'resume', 'explain', 'claim', 'invalidate', 'dispose']),
      createTarget: owner.createFiniteFeasibilityTarget, refine: owner.refinePredicate, resume: owner.resumeRefinement,
      explain: owner.explainRefinement, claim: owner.readCheckedFiniteFeasibilityClaim,
      invalidate: owner.invalidateFiniteFeasibilityTarget, dispose: owner.retireFiniteFeasibilityTarget });
  },
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
      capabilities: Object.freeze(['compile', 'inspectCompilation', 'assignSplits', 'compileJudgments', 'inspectJudgments', 'compileTrainingCohort',
        'compileVectors', 'createQueryTraining', 'advanceQueryTraining', 'checkpointQueryTraining', 'disposeQueryTraining', 'disposeVectors',
        'materialize', 'candidatePacket', 'readSource', 'runCandidate', 'score', 'runCohort', 'compareCohort', 'dispose', 'disposeTask']),
      compile: compiler.compileEvidenceTask, inspectCompilation: compiler.inspectEvidenceTaskCompilation, assignSplits: split.assignEvidenceTaskSplits,
      compileJudgments: async (...args) => (await import('../../src/retrieval/evaluation/tasks/judgments.js')).compileEvidenceTaskJudgments(...args),
      inspectJudgments: async (...args) => (await import('../../src/retrieval/evaluation/tasks/judgments.js')).inspectEvidenceTaskJudgments(...args),
      compileTrainingCohort: async (...args) => (await import('../../src/shared/retrieval-adaptation/cohort.js')).compileRetrievalTrainingCohort(...args),
      compileVectors: async (...args) => (await import('../../src/shared/retrieval-adaptation/training.js')).compileFrozenRetrievalVectors(...args),
      createQueryTraining: async (...args) => (await import('../../src/shared/retrieval-adaptation/training.js')).createRetrievalTrainingSession(...args),
      advanceQueryTraining: async (...args) => (await import('../../src/shared/retrieval-adaptation/training.js')).advanceRetrievalTraining(...args),
      checkpointQueryTraining: async (...args) => (await import('../../src/shared/retrieval-adaptation/training.js')).exportRetrievalTrainingCheckpoint(...args),
      disposeQueryTraining: async (...args) => (await import('../../src/shared/retrieval-adaptation/training.js')).disposeRetrievalTraining(...args),
      disposeVectors: async (...args) => (await import('../../src/shared/retrieval-adaptation/training.js')).disposeFrozenRetrievalVectors(...args),
      materialize: view.materializeEvidenceTaskView, candidatePacket: view.projectEvidenceTaskView,
      readSource: view.readEvidenceTaskViewSource, runCandidate: baseline.runVisibleEvidenceBaseline,
      runCohort: async (...args) => (await import('./tasks/cohort.js')).evaluateEvidenceTaskCohort(...args),
      compareCohort: async (...args) => (await import('./tasks/quality.js')).compareEvidenceTaskCohort(...args),
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
