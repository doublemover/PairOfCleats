import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-editor-ready-a-' });
const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-editor-ready-b-' });
const cliPath = path.join(first, 'bin', 'pairofcleats.js');
const harness = createVsCodeRuntimeHarness({ repoRoot: first,
  workspaceFolders: [{ name: 'A', path: first }, { name: 'B', path: second }],
  activeFile: path.join(first, 'src', 'app.ts'), globalConfigValues: { cliPath } });
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const ready = JSON.stringify({ ok: true, host: '127.0.0.1', port: 7345,
  baseUrl: 'http://127.0.0.1:7345', repo: first }) + '\n';
try {
  harness.activate();
  harness.queuedResults.push({ persistent: true, stdout: '[api] listening (plain log only)\n' });
  await harness.runCommand('pairofcleats.serviceApiStart');
  await flush();
  const apiChild = harness.spawnCalls[0].child;
  assert.ok(harness.infoMessages.some(message => /starting.*Readiness has not been observed/.test(message)));
  assert.equal(harness.infoMessages.some(message => /ready at/.test(message)), false);
  apiChild.stdout.emit('data', Buffer.from(ready));
  apiChild.stdout.emit('data', Buffer.from(ready));
  assert.equal(harness.infoMessages.filter(message => /ready at/.test(message)).length, 1,
    'one authoritative startup observation produces one ready announcement');
  const apiSession = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];

  harness.setActiveFile(path.join(second, 'src', 'app.ts'));
  harness.queuedResults.push({ persistent: true, stdout: JSON.stringify({ proto: 'poc.progress@2',
    event: 'task:progress', ts: '2026-10-22T10:00:00.000Z', stage: 'parsing', current: 2, total: 5 }) + '\n' });
  await harness.runCommand('pairofcleats.indexWatchStart');
  await flush();
  const watchChild = harness.spawnCalls[1].child;
  const watchSession = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
  assert.notEqual(apiSession.sessionId, watchSession.sessionId);
  harness.quickPickQueue.push(items => items.find(item => item.entry.sessionId === apiSession.sessionId), 'Inspect Logs');
  await harness.runCommand('pairofcleats.inspectTasks');
  assert.ok(harness.openedDocuments.some(document => document.uri?.content?.includes('Endpoint (readiness observed): http://127.0.0.1:7345')));

  const signals = [];
  apiChild.kill = signal => { signals.push(signal); return true; };
  const stopping = harness.extension._test.stopManagedCommand({ targetId: 'pairofcleats.serviceApiStart' },
    { sessionId: apiSession.sessionId, repoRoot: first });
  await flush();
  const announcements = harness.infoMessages.filter(message => /ready at/.test(message)).length;
  apiChild.stdout.emit('data', Buffer.from(ready));
  apiChild.stdout.emit('data', Buffer.from(JSON.stringify({ proto: 'poc.progress@2', event: 'task:progress',
    ts: '2026-10-22T10:00:01.000Z', stage: 'late-startup', current: 1, total: 1 }) + '\n'));
  assert.equal(harness.infoMessages.filter(message => /ready at/.test(message)).length, announcements,
    'late startup readiness cannot acquire authority while the selected task is stopping');
  assert.equal(signals.length, 1);
  assert.equal(watchChild.killed, false, 'stopping exact task A preserves task B');
  apiChild.emit('close', 0);
  await stopping;
  apiChild.stdout.emit('data', Buffer.from(ready));
  assert.equal(harness.infoMessages.filter(message => /ready at/.test(message)).length, announcements,
    'terminal task output cannot promote readiness');
  const stopped = harness.workspaceStateStore.get('pairofcleats.workflowSessions').find(row => row.sessionId === apiSession.sessionId);
  assert.equal(stopped.status, 'cancelled');
  await harness.extension._test.stopManagedCommand({ targetId: 'pairofcleats.indexWatchStart' }, { sessionId: watchSession.sessionId });
} finally {
  await harness.extension.deactivate();
  harness.restoreGlobals();
  for (const directory of [first, second]) fs.rmSync(directory, { recursive: true, force: true });
}
console.log('Authoritative readiness, stopping-state publication and exact multi-repository task controls passed');
