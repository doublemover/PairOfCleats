import assert from 'node:assert/strict';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

// Actual registered semantic command; inert existing process/editor boundaries.
const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-semantic-error-command-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: fixture.root, workspaceFolders: [{ path: fixture.root }],
  globalConfigValues: { cliPath: fixture.resolvePath('bin', 'pairofcleats.js'), apiExecutionMode: 'cli' } });
let originalNotify;
try {
  harness.activate(); originalNotify = harness.fakeVscode.window.showErrorMessage;
  const node = { resultSet: { repoRoot: fixture.root }, hit: { chunkUid: 'original-selected-chunk' } };
  const run = () => harness.registeredCommands.get('pairofcleats.semanticEvidence')(node);
  for (const primary of [undefined, null, false, 0, '']) {
    const calls = harness.spawnCalls.length;
    harness.quickPickQueue.push(() => { throw primary; }); const evidence = await run();
    assert.equal(evidence.primaryError, primary); assert.equal(evidence.kind, 'editor-failure-evidence');
    assert.equal(harness.spawnCalls.length, calls, 'failure in original generation choice cannot issue a semantic request');
  }
  let reads = 0;
  const inspection = Object.freeze({ cacheOwnershipReleased: () => false });
  const primary = Object.freeze(Object.defineProperty({}, 'message', { get() { reads++; throw inspection; } }));
  const notification = Object.freeze({ sceneOwnershipReleased: () => false });
  harness.fakeVscode.window.showErrorMessage = async () => { throw notification; };
  harness.quickPickQueue.push(() => { throw primary; }); const failure = await run();
  assert.equal(failure.primaryError, primary); assert.deepEqual(failure.inspectionErrors, [inspection, notification]); assert.equal(reads, 1);
  assert.equal(failure.inspectionErrors[0].cacheOwnershipReleased(), false); assert.equal(failure.inspectionErrors[1].sceneOwnershipReleased(), false);
} finally {
  if (originalNotify) harness.fakeVscode.window.showErrorMessage = originalNotify;
  await harness.extension.deactivate(); harness.restoreGlobals();
}
console.log('Registered semantic falsey/getter/notification original failure controls authored; execution deferred.');
