import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
for (const scenario of ['prompt', 'operator', 'managed-before-spawn', 'managed-running']) {
  const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-config-revocation-' });
  const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
    globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
  try {
    harness.activate();
    if (scenario === 'prompt') {
      let entered, cancelled = 0;
      const ready = new Promise(resolve => { entered = resolve; });
      harness.fakeVscode.window.showInputBox = (_options, token) => new Promise(resolve => {
        token.onCancellationRequested(() => { cancelled++; resolve(undefined); }); entered();
      });
      const pending = harness.runCommand('pairofcleats.search'); await ready;
      harness.setGlobalConfiguration({ apiExecutionMode: 'require' }); await pending;
      assert.equal(cancelled, 1); assert.equal(harness.spawnCalls.length, 0);
    } else if (scenario === 'managed-before-spawn') {
      let release, entered;
      const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
      const update = harness.context.workspaceState.update;
      let held = false;
      harness.context.workspaceState.update = async (key, value) => {
        if (key === 'pairofcleats.workflowSessions' && !held) { held = true; entered(); await gate; }
        return update(key, value);
      };
      const pending = harness.runCommand('pairofcleats.indexWatchStart'); await ready;
      harness.setGlobalConfiguration({ apiExecutionMode: 'require' }); release(); await pending;
      assert.equal(harness.spawnCalls.length, 0, 'a pending identity write does not make a process an already-started background owner');
      assert.equal(harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0].status, 'interrupted');
    } else {
      harness.queuedResults.push({ persistent: true });
      const pending = harness.runCommand(scenario === 'operator' ? 'pairofcleats.configDump' : 'pairofcleats.indexWatchStart');
      await flush(); const child = harness.spawnCalls[0].child;
      if (scenario === 'managed-running') await pending;
      harness.setGlobalConfiguration({ apiExecutionMode: 'require' }); await flush();
      if (scenario === 'operator') {
        await pending; assert.equal(child.killed, true);
        assert.equal(harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0].status, 'interrupted');
        assert(!harness.infoMessages.some(message => /Config Dump completed/.test(message)));
      } else {
        assert.equal(child.killed, false, 'an admitted, running background workflow retains its original runtime snapshot');
        assert.equal(harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0].status, 'running');
      }
    }
  } finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
}
console.log('Registered configuration-flip prompt/process/pre-spawn revocation and background snapshot controls authored; execution deferred.');
