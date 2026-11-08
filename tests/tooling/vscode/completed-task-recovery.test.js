import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
const require = createRequire(import.meta.url);
const { createTaskObservations, taskRecoveryActions } = require('../../../extensions/vscode/task-observations.js');

const observations = createTaskObservations({ maxEntries: 2 });
for (let index = 0; index < 3; index += 1) observations.remember({
  sessionId: String(index), key: String(index), repoRoot: '/owned-target',
  spec: { id: 'registered-command', title: 'Build' }, child: { pid: 1234 },
  progress: { startedAt: 1 }, logTail: [{ text: 'retained evidence' }]
}, { status: 'failed', summaryLine: 'Failed' });
assert.deepEqual(observations.list().map(row => row.sessionId), ['2', '1']);
assert.equal('child' in observations.list()[0], false);
assert.equal('pid' in observations.list()[0], false);
assert.equal(taskRecoveryActions(observations.list()[0], false).some(item => item.action === 'stop'), false);
assert.equal(taskRecoveryActions({ status: 'failed', cleanupUnconfirmed: true }, false).some(item => item.action === 'retry'), false);

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-completed-task-recovery-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root,
  globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
try {
  harness.activate();
  harness.queuedResults.push({ code: 1, stderr: 'controlled index failure\n' });
  await harness.runCommand('pairofcleats.indexBuild');
  const completed = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
  assert.equal(completed.status, 'failed');
  harness.quickPickQueue.push(items => items.find(item => item.entry.sessionId === completed.sessionId), 'Inspect Logs');
  await harness.runCommand('pairofcleats.inspectTasks');
  assert.equal(harness.spawnCalls.length, 1, 'inspection does not retry a failed mutation');
  const report = harness.openedDocuments.map(document => document.uri?.content || '').join('\n');
  assert.match(report, /controlled index failure/);
  assert.match(report, /Read-only completed task observation/);

  harness.queuedResults.push({ persistent: true });
  await harness.runCommand('pairofcleats.serviceApiStart');
  const session = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
  const child = harness.spawnCalls[1].child;
  child.kill = () => false;
  const stopping = harness.extension._test.stopManagedCommand({ targetId: 'pairofcleats.serviceApiStart' }, { sessionId: session.sessionId });
  await new Promise(setImmediate);
  child.emit('close', 0);
  await stopping;
  await harness.runCommand('pairofcleats.serviceApiStart');
  assert.equal(harness.spawnCalls.length, 2, 'an unconfirmed prior tree lifetime blocks replacement of that owned service');
  assert.ok(harness.errorMessages.some(message => /earlier owned tree stop remains unconfirmed/.test(message)));
} finally {
  await harness.extension.deactivate();
  harness.restoreGlobals();
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Completed task inspection retains bounded evidence without process authority or automatic retry');
