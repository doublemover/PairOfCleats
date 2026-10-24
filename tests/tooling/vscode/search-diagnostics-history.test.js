import assert from 'node:assert/strict';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';
import { buildSearchDiagnostics } from '../../../src/retrieval/output/search-diagnostics.js';
import { explainEmptyResults } from '../../../src/retrieval/output/empty-results.js';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'editor-search-diagnostics-' });
const retrieval = { backend: { selected: 'memory', requested: 'sqlite', selectionReason: 'sqlite-unavailable', availabilityDriven: true },
  fidelity: { status: 'fallback-derived' }, freshness: { byMode: { code: { generationKey: 'captured-generation' } } } };
retrieval.emptyResults = explainEmptyResults({ filtersActive: true, backend: retrieval.backend });
retrieval.diagnostics = buildSearchDiagnostics(retrieval);
const payload = { code: [], prose: [], records: [], extractedProse: [], retrieval };
for (const transport of ['cli', 'api']) {
  const harness = createVsCodeRuntimeHarness({ repoRoot: workspace.root, configValues: { searchMode: 'code' },
    globalConfigValues: { apiExecutionMode: transport === 'api' ? 'require' : 'cli', apiServerUrl: 'http://127.0.0.1:4311' } });
  const mapping = transport === 'api' ? prepareServiceMappingFixture(harness, { repoRoot: workspace.root }) : null;
  try {
    harness.activate();
    harness.inputQueue.push('zero-hit-query');
    if (transport === 'api') harness.queuedFetchResults.push({ json: { ok: true, runtimeManifest: getRuntimeCapabilityManifest() } },
      { json: mapping.status }, { json: { ok: true, result: payload } });
    else harness.queuedResults.push({ code: 0, stdout: JSON.stringify(payload) });
    await harness.runCommand('pairofcleats.search');
    const original = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0];
    assert.deepEqual(original.searchDiagnostics, retrieval.diagnostics);
    assert.ok(harness.infoMessages.some(message => message.includes(retrieval.emptyResults[0].message)));
    assert.equal(harness.executeCommandCalls.length, 0, 'receiving a reason never invokes its suggested workflow');
    const beforeDispatch = [harness.spawnCalls.length, harness.fetchCalls.length];
    harness.quickPickQueue.push(items => items[0]);
    await harness.runCommand('pairofcleats.showSearchHistory');
    assert.deepEqual([harness.spawnCalls.length, harness.fetchCalls.length], beforeDispatch);
    assert.equal(harness.workspaceStateStore.get('pairofcleats.searchHistory')[0].resultSetId, original.resultSetId);
    const output = harness.outputEvents.filter(row => row.kind === 'append').map(row => row.line).join('\n');
    for (const fact of ['memory', 'fallback-derived', 'captured-generation', 'query-with-filters', 'Saved evidence']) assert.ok(output.includes(fact), fact);

    const freshRetrieval = { backend: { selected: 'memory', requested: 'memory' }, fidelity: { status: 'complete' } };
    freshRetrieval.diagnostics = buildSearchDiagnostics(freshRetrieval);
    const refreshed = { ...payload, retrieval: freshRetrieval, code: [{ file: 'src/app.ts', startLine: 1 }] };
    if (transport === 'api') harness.queuedFetchResults.push({ json: { result: refreshed } });
    else harness.queuedResults.push({ code: 0, stdout: JSON.stringify(refreshed) });
    await harness.runCommand('pairofcleats.repeatLastSearch');
    const history = harness.workspaceStateStore.get('pairofcleats.searchHistory');
    assert.equal(history.length, 2);
    assert.equal(history[0].searchDiagnostics.backend.fidelity, 'complete');
    assert.equal(history[0].searchDiagnostics.reasons.length, 0);
    assert.deepEqual(history[1].searchDiagnostics, retrieval.diagnostics, 'rerun never overwrites historical diagnostics');
  } finally { harness.restoreGlobals(); }
}
console.log('CLI/API editor search retains diagnostics across history reopen and explicit rerun.');
