import { randomUUID } from 'node:crypto';
import { buildSuggestTestsReport } from '../../../src/graph/suggest-tests.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { finiteViewFields } from '../../../src/index/semantic/views/finite-input.js';
import { SUGGESTION_REVISION_PROFILE, SUGGESTION_REVISION_RECEIPT_SCHEMA } from '../../../src/contracts/schemas/revision-suggestions.js';
import { compileSuggestionRevisionScenario, sealSuggestionRevisionEdits, suggestionStateId, suggestionScenarioError } from './suggestion-scenario.js';
import { captureSuggestionRevisionOutput, referenceSuggestionRevision, compareSuggestionRevision } from './suggestion-reference.js';
import { revisionKey, revisionScenarioId } from './scenario.js';
import { minimizeRevisionSequence } from './minimize.js';

const owned = new WeakMap(), validate = compileSchema(createAjv({ strict: true, allErrors: true }), SUGGESTION_REVISION_RECEIPT_SCHEMA);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const get = handle => { const value = owned.get(handle); if (!value) throw new TypeError('Original test-suggestion execution handle required.'); return value; };
const runId = () => 'run-' + randomUUID();
const signature = (scenario, state) => revisionScenarioId({ profile: SUGGESTION_REVISION_PROFILE, repositoryNamespace: scenario.repositoryNamespace, state });

/** This invokes the real consumer with exact finite original supports. It does
 * not manufacture a source import graph or claim that paths execute a test.
 * Graphs are built afresh at each revision, under their actual state signature. */
const candidate = (scenario, state, remainingMs, signal) => {
  throwIfAborted(signal);
  const nodes = state.nodes.map(id => ({ id, file: id, out: state.edges.filter(edge => edge.from === id).map(edge => edge.to) }));
  const report = buildSuggestTestsReport({ changed: state.changedPaths, tests: state.testPaths, graphRelations: { importGraph: { nodes } },
    indexSignature: signature(scenario, state), now: () => '2000-01-01T00:00:00.000Z',
    caps: { maxNodes: 12, maxEdges: 64, maxWorkUnits: 64, maxCandidates: 8, maxSeeds: 4, maxSuggestions: 8,
      maxWallClockMs: Math.max(0, remainingMs()) } });
  throwIfAborted(signal);
  if (report.version !== '1.0.0') throw suggestionScenarioError('Suggestion consumer report changed; qualify and version its adapter.');
  const output = captureSuggestionRevisionOutput({ indexSignature: report.provenance.indexSignature, changedPaths: report.changed.map(row => row.path),
    graphRows: report.suggestions.filter(row => row.fidelity.source === 'graph').map(row => {
      const witness = row.witnessPath;
      if (witness && (witness.to?.type !== 'file' || witness.nodes.some(node => node.type !== 'file'))) throw suggestionScenarioError('Only original file witness paths are admitted.');
      return { testPath: row.testPath, distance: row.fidelity.graphDistance, score: row.score,
        witness: (witness?.nodes || []).map(node => node.path), witnessTarget: witness?.to.path ?? null, witnessDistance: witness?.distance ?? null };
    }),
    heuristicPaths: report.suggestions.filter(row => row.fidelity.source === 'heuristic').map(row => row.testPath),
    graphAvailable: report.fidelity.graph.available, graphUsed: report.fidelity.graph.used,
    fidelitySource: report.fidelity.source, fidelityState: report.fidelity.state, reasonCodes: report.fidelity.reasonCodes,
    complete: report.execution?.state === 'complete' && report.truncation === null });
  return { output, observed: report.execution.observed };
};
const optionsFor = options => {
  const result = finiteViewFields(options, [], ['signal', 'maxMs', 'maxReferenceWork'], suggestionScenarioError);
  const { signal = null, maxMs = 1000, maxReferenceWork = 4096 } = result;
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000
    || !Number.isSafeInteger(maxReferenceWork) || maxReferenceWork < 0 || maxReferenceWork > 4096
    || signal !== null && !(signal instanceof AbortSignal)) throw suggestionScenarioError('Invalid bounded test-suggestion execution allowance.');
  return { signal, maxMs, maxReferenceWork };
};
export const runSuggestionRevisionScenario = (input, options = {}) => {
  const began = performance.now(), { signal, maxMs, maxReferenceWork } = optionsFor(options); throwIfAborted(signal);
  const compiled = compileSuggestionRevisionScenario(input), checkpoints = [], remainingMs = () => maxMs - (performance.now() - began);
  let stopped = false, disagreement = false;
  for (const [index, state] of compiled.states.entries()) {
    throwIfAborted(signal);
    const checkpointId = index ? compiled.scenario.revisions[index - 1].id : 'base', stateId = suggestionStateId(state);
    const notRun = () => { stopped = true; checkpoints.push({ index, checkpointId, stateId, outcome: 'not-run', reason: 'run-work-budget' }); };
    if (stopped || remainingMs() <= 0) { notRun(); continue; }
    const candidateBegan = performance.now(), actual = candidate(compiled.scenario, state, remainingMs, signal), candidateMs = performance.now() - candidateBegan;
    const rebuildBegan = performance.now(), fresh = candidate(compiled.scenario, state, remainingMs, signal), rebuildMs = performance.now() - rebuildBegan;
    const referenceBegan = performance.now(), reference = referenceSuggestionRevision(state, { signal, maxReferenceWork, check: () => remainingMs() > 0 });
    const claim = actual.output.indexSignature !== signature(compiled.scenario, state) ? { outcome: 'fail', reason: 'original-index-signature-mismatch' }
      : compareSuggestionRevision(state, actual.output, reference);
    const parity = !actual.output.complete || !fresh.output.complete ? 'unknown' : revisionKey(actual.output) === revisionKey(fresh.output) ? 'pass' : 'fail';
    const retained = claim.outcome === 'fail' && reference.rows !== null && !disagreement;
    if (retained) disagreement = true;
    checkpoints.push({ index, checkpointId, stateId, outcome: parity === 'fail' || claim.outcome === 'fail' ? 'fail' : parity === 'unknown' ? 'unknown' : claim.outcome,
      candidateExecutionId: runId(), rebuildExecutionId: runId(), candidateOutputId: revisionScenarioId(actual.output), rebuildOutputId: revisionScenarioId(fresh.output),
      referenceOutputId: reference.rows === null ? null : revisionScenarioId(reference.rows), originalEdgeIds: state.edges.map(row => row.id), output: actual.output,
      claims: [{ tier: 'independent-finite-import-distance-matrix', relation: 'graph-suggestions-shortest-distance-and-valid-source-witnesses',
        ...claim, counterexample: retained ? { expected: reference.rows, actual: actual.output } : null },
      { tier: 'same-consumer-fresh-graph', relation: 'exact-output-with-original-index-signature', outcome: parity }],
      work: { candidateMs, rebuildMs, referenceMs: performance.now() - referenceBegan, referenceOperations: reference.operations,
        graphBuilds: 2, nodes: state.nodes.length, edgeSupports: state.edges.length, candidateNeighborReads: actual.observed.neighborReads,
        candidateWitnessLinks: actual.observed.witnessLinks } });
  }
  const executionId = runId(), receipt = freeze({ schemaVersion: 1, kind: 'finite-import-test-suggestion-revision-run', profile: SUGGESTION_REVISION_PROFILE,
    scenarioId: compiled.scenarioId, executionId, family: compiled.scenario.family, seed: compiled.scenario.seed, repositoryNamespace: compiled.scenario.repositoryNamespace,
    outcome: checkpoints.some(row => row.outcome === 'fail') ? 'fail' : checkpoints.every(row => row.outcome === 'pass') ? 'pass' : 'unknown', checkpoints,
    consumer: 'buildSuggestTestsReport:1.0.0', scope: 'supplied-finite-import-supports; no-source-extraction-publication-or-execution-coverage-claim',
    limits: { maxMs, maxReferenceWork, receiptBytes: 262144 }, elapsedMs: performance.now() - began });
  if (!validate(receipt)) throw suggestionScenarioError('Invalid original test-suggestion revision receipt.');
  if (Buffer.byteLength(revisionKey(receipt)) > 262144) throw suggestionScenarioError('Test-suggestion receipt exceeds its output allowance.');
  const handle = Object.freeze({ executionId, scenarioId: compiled.scenarioId }); owned.set(handle, { compiled, receipt }); return handle;
};
export const readSuggestionRevisionRun = handle => get(handle).receipt;
export const retireSuggestionRevisionRun = handle => { const original = get(handle); owned.delete(handle); return Object.freeze({ executionId: original.receipt.executionId, retired: true }); };
export const compareSuggestionRevisionOutput = input => {
  const { scenario, checkpoint, actual } = finiteViewFields(input, ['scenario', 'checkpoint', 'actual'], [], suggestionScenarioError);
  const compiled = compileSuggestionRevisionScenario(scenario);
  if (!Number.isSafeInteger(checkpoint) || checkpoint < 0 || checkpoint >= compiled.states.length) throw suggestionScenarioError('Exact admitted suggestion checkpoint required.');
  const state = compiled.states[checkpoint], output = captureSuggestionRevisionOutput(actual), reference = referenceSuggestionRevision(state);
  return freeze({ diagnosticOnly: true, qualifiedExecution: false,
    ...(output.indexSignature !== signature(compiled.scenario, state) ? { outcome: 'fail', reason: 'original-index-signature-mismatch' } : compareSuggestionRevision(state, output, reference)) });
};
export const minimizeSuggestionRevisionFailure = (handle, options = {}) => {
  const original = get(handle), captured = finiteViewFields(options, ['checkpointId'], ['maxAttempts', 'maxMs', 'signal'], suggestionScenarioError);
  const { checkpointId } = captured;
  return minimizeRevisionSequence({ originalScenario: original.compiled.scenario, originalReceipt: original.receipt,
    matches: receipt => receipt.checkpoints.some(row => row.checkpointId === checkpointId && row.claims?.some(claim => claim.tier === 'independent-finite-import-distance-matrix' && claim.outcome === 'fail')),
    seal: sealSuggestionRevisionEdits, invalidScenario: error => error.code === 'ERR_SUGGESTION_REVISION_SCENARIO',
    run: runSuggestionRevisionScenario, read: readSuggestionRevisionRun, dispose: retireSuggestionRevisionRun,
    kind: 'finite-test-suggestion-revision-minimization', selection: { checkpointId }, predicate: 'same-checkpoint-independent-import-suggestion-disagreement' }, captured);
};
