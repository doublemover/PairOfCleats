#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  createVsCodeRuntimeTempRepo,
  createVsCodeRuntimeHarness
} from '../../helpers/vscode/runtime-harness.js';
import {
  assertNoRuntimeErrors,
  assertRegisteredCommands,
  assertSpawnArgs
} from '../../helpers/vscode/runtime-assertions.js';

const repoA = createVsCodeRuntimeTempRepo({
  prefix: 'poc-vscode-session-a-',
  toolScripts: ['tools/config/dump.js']
});
const repoB = createVsCodeRuntimeTempRepo({
  prefix: 'poc-vscode-session-b-',
  toolScripts: ['tools/config/dump.js']
});
const staleSession = {
  sessionId: 'stale-running-session',
  commandId: 'pairofcleats.configDump',
  title: 'PairOfCleats: Config Dump',
  repoRoot: repoA,
  status: 'running',
  startedAt: '2026-03-12T00:00:00.000Z',
  invocation: {
    kind: 'operator',
    command: process.execPath,
    args: [path.join(repoA, 'tools', 'config', 'dump.js'), '--json', '--repo', repoA],
    timeoutMs: 60000
  }
};
const harness = createVsCodeRuntimeHarness({
  repoRoot: repoA,
  workspaceFolders: [
    { name: 'repo-a', path: repoA },
    { name: 'repo-b', path: repoB }
  ],
  activeFile: path.join(repoA, 'src', 'app.ts'),
  workspaceState: {
    'pairofcleats.workflowSessions': [staleSession]
  }
});

harness.activate();

try {
  await new Promise((resolve) => setImmediate(resolve));

  assertRegisteredCommands(harness.registeredCommands, [
    'pairofcleats.showWorkflowStatus',
    'pairofcleats.rerunLastWorkflow',
    'pairofcleats.showRecentWorkflows'
  ]);

  let storedSessions = harness.workspaceStateStore.get('pairofcleats.workflowSessions');
  const statusBar = harness.statusBarItems[0];
  assert.equal(storedSessions[0].status, 'interrupted');
  assert.match(statusBar.text, /PairOfCleats: .*interrupted/i);
  assert.equal(statusBar.command, 'pairofcleats.showWorkflowStatus');

  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      repoRoot: repoA,
      policy: { quality: { value: 'max', source: 'config' } },
      derived: { cacheRoot: path.join(repoA, '.cache'), repoCacheRoot: path.join(repoA, '.cache', 'repo') }
    })
  });
  await harness.runCommand('pairofcleats.configDump');
  assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Config Dump completed.');
  storedSessions = harness.workspaceStateStore.get('pairofcleats.workflowSessions');
  assert.equal(storedSessions[0].status, 'succeeded');
  assert.equal(storedSessions[0].repoRoot, repoA);
  assert.equal(storedSessions[0].commandId, 'pairofcleats.configDump');
  assert.deepEqual(
    storedSessions[0].invocation.args,
    [path.join(repoA, 'tools', 'config', 'dump.js'), '--json', '--repo', repoA]
  );
  assert.match(statusBar.text, /PairOfCleats: .*succeeded/i);

  harness.setActiveFile(path.join(repoB, 'src', 'app.ts'));
  assert.equal(statusBar.text, `PairOfCleats: ${path.basename(repoB)}`);

  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      repoRoot: repoA,
      policy: { quality: { value: 'max', source: 'config' } },
      derived: { cacheRoot: path.join(repoA, '.cache'), repoCacheRoot: path.join(repoA, '.cache', 'repo') }
    })
  });
  await harness.runCommand('pairofcleats.rerunLastWorkflow');
  assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Config Dump completed.');
  assertSpawnArgs(harness.spawnCalls, 1, harness.spawnCalls[0].args);

  harness.quickPickQueue.push((items) => items.find((item) => item.action === 'output'));
  await harness.runCommand('pairofcleats.showWorkflowStatus');
  assert.ok(harness.outputEvents.some((event) => event.kind === 'show'));

  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      repoRoot: repoA,
      policy: { quality: { value: 'max', source: 'config' } },
      derived: { cacheRoot: path.join(repoA, '.cache'), repoCacheRoot: path.join(repoA, '.cache', 'repo') }
    })
  });
  harness.quickPickQueue.push((items) => items.find((item) => item.session));
  await harness.runCommand('pairofcleats.showRecentWorkflows');
  assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Config Dump completed.');
  assertSpawnArgs(harness.spawnCalls, 2, harness.spawnCalls[0].args);
  assertNoRuntimeErrors(harness.errorMessages);
} finally {
  harness.restoreGlobals();
}

console.log('vscode session runtime test passed');
