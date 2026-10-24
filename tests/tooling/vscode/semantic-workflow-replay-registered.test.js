import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

for (const command of ['indexBuild', 'indexWatchStart', 'serviceApiStart', 'serviceIndexerStart', 'impact']) {
  const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-semantic-replay-a-' });
  const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-semantic-replay-b-' });
  const installation = createVsCodeRuntimeTempRepo({ prefix: 'poc-semantic-replay-cli-' });
  const oldCli = path.join(first, 'bin', 'pairofcleats.js'), currentCli = path.join(installation, 'bin', 'pairofcleats.js');
  const harness = createVsCodeRuntimeHarness({ repoRoot: first, activeFile: path.join(first, 'src', 'app.ts'),
    workspaceFolders: [{ path: first }, { path: second }], globalConfigValues: { cliPath: oldCli, cliArgs: ['--trace'] } });
  const persistent = ['indexWatchStart', 'serviceApiStart', 'serviceIndexerStart'].includes(command);
  const payload = command === 'impact' ? { direction: 'downstream', depth: 2, impacted: [], warnings: [], truncation: [] } : {};
  try {
    harness.activate();
    if (command === 'impact') {
      harness.inputQueue.push('', 'src/app.ts', '2');
      harness.quickPickQueue.push(items => items.find(item => item.value === 'downstream'));
    }
    harness.queuedResults.push(persistent ? { persistent: true } : { code: 0, stdout: JSON.stringify(payload) });
    await harness.runCommand(`pairofcleats.${command}`);
    const original = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
    if (persistent) {
      await harness.extension._test.stopManagedCommand({ targetId: `pairofcleats.${command}` },
        { sessionId: original.sessionId, repoRoot: first });
    }
    if (command === 'impact') {
      assert.deepEqual(original.invocation.request.inputContext, { seed: '', changed: ['src/app.ts'], direction: 'downstream', depth: 2 });
    }
    const oldArgs = [...harness.spawnCalls[0].args];
    harness.setActiveFile(path.join(second, 'src', 'app.ts'));
    harness.setGlobalConfiguration({ cliPath: currentCli });
    harness.fakeVscode.window.showInputBox = async () => assert.fail('exact replay must reuse its captured semantic inputs');
    harness.queuedResults.push(persistent ? { persistent: true } : { code: 0, stdout: JSON.stringify(payload) });
    await harness.runCommand('pairofcleats.rerunLastWorkflow');
    assert.equal(harness.spawnCalls.length, 2, command);
    const replay = harness.spawnCalls[1];
    assert.deepEqual(replay.args, [currentCli, ...oldArgs.slice(1)], 'replay reconstructs semantic invocation using the current configured CLI');
    assert.equal(replay.options.cwd, first, 'current editor focus cannot retarget the saved operation');
    if (persistent) {
      const session = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
      await harness.extension._test.stopManagedCommand({ targetId: `pairofcleats.${command}` }, { sessionId: session.sessionId, repoRoot: first });
    }
    assert.deepEqual(harness.errorMessages, []);
  } finally {
    await harness.extension.deactivate(); harness.restoreGlobals();
    for (const root of [first, second, installation]) fs.rmSync(root, { recursive: true, force: true });
  }
}

const numeric = createVsCodeRuntimeTempRepo({ prefix: 'poc-workflow-integer-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: numeric, activeFile: path.join(numeric, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(numeric, 'bin', 'pairofcleats.js') } });
try {
  harness.activate();
  for (const value of ['2.5', '1e3', '9007199254740992']) {
    harness.inputQueue.push('file:src/app.ts', value);
    await harness.runCommand('pairofcleats.contextPack');
    assert.equal(harness.spawnCalls.length, 0, 'malformed numeric workflow input must not be silently floored/coerced');
    assert.match(harness.errorMessages.at(-1), /positive integer/);
  }
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(numeric, { recursive: true, force: true }); }
console.log('Registered managed/operator semantic replay, current CLI authority and integer-input controls authored; execution deferred.');
