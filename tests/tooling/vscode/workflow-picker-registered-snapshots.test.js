import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

for (const scenario of ['recent', 'status', 'copied-recent', 'removed-root']) {
  const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-workflow-picker-a-' });
  const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-workflow-picker-b-' });
  const session = { sessionId: 'original-session', title: 'PairOfCleats: Config Dump', commandId: 'pairofcleats.configDump',
    repoRoot: first, status: 'succeeded', invocation: { kind: 'operator', command: 'obsolete.exe', args: ['obsolete-input'] } };
  const harness = createVsCodeRuntimeHarness({ repoRoot: first, activeFile: path.join(first, 'src', 'app.ts'),
    workspaceFolders: [{ path: first }, { path: second }], globalConfigValues: { cliPath: path.join(first, 'bin', 'pairofcleats.js') },
    workspaceState: { 'pairofcleats.workflowSessions': [session] } });
  try {
    harness.activate();
    harness.quickPickQueue.push(async items => {
      assert(Object.isFrozen(items));
      const picked = scenario === 'status' ? items.find(item => item.action === 'rerun-last') : items.find(item => item.session);
      if (picked.session) {
        assert(Object.isFrozen(picked.session));
        assert.throws(() => { picked.session.repoRoot = second; }, TypeError);
      }
      if (scenario === 'copied-recent') return { ...picked };
      if (scenario === 'removed-root') { harness.setWorkspaceFolders([{ path: second }]); return picked; }
      harness.setActiveFile(path.join(second, 'src', 'app.ts'));
      harness.queuedResults.push({ code: 0, stdout: '{}' }); await harness.runCommand('pairofcleats.doctor');
      harness.queuedResults.push({ code: 0, stdout: '{}' }); return picked;
    });
    await harness.runCommand(scenario === 'status' ? 'pairofcleats.showWorkflowStatus' : 'pairofcleats.showRecentWorkflows');
    if (scenario === 'copied-recent' || scenario === 'removed-root') {
      assert.equal(harness.spawnCalls.length, 0, 'obsolete/copied picker choices cannot dispatch replay');
      if (scenario === 'copied-recent') assert.match(harness.errorMessages.at(-1), /original session/);
    } else {
      assert.equal(harness.spawnCalls.length, 2);
      const args = harness.spawnCalls[1].args;
      assert.deepEqual(args.slice(1, 3), ['config', 'dump']);
      assert.equal(args[args.indexOf('--repo') + 1], first, 'replay retains the displayed original session after another workflow completes');
      assert(!args.includes('obsolete-input')); assert.notEqual(harness.spawnCalls[1].command, 'obsolete.exe');
    }
  } finally {
    await harness.extension.deactivate(); harness.restoreGlobals();
    for (const root of [first, second]) fs.rmSync(root, { recursive: true, force: true });
  }
}
console.log('Registered status/recent workflow snapshots, original choices and stale-root controls authored; execution deferred.');
