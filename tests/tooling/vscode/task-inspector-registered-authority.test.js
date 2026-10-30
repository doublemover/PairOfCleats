import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-task-inspector-authority-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
const flush = () => new Promise(setImmediate);
try {
  harness.activate(); harness.queuedResults.push({ persistent: true });
  await harness.runCommand('pairofcleats.serviceApiStart'); await flush();
  const child = harness.spawnCalls[0].child;
  child.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true, host: '127.0.0.1', port: 7345,
    baseUrl: 'http://127.0.0.1:7345', repo: root }) + '\n'));
  assert(harness.statusBarItems.some(item => /ready/.test(item.text) && /Endpoint \(readiness observed\)/.test(item.tooltip)),
    'status bar consumes authoritative readiness for the actual owned task');
  harness.quickPickQueue.push(items => ({ ...items[0] }));
  await harness.runCommand('pairofcleats.inspectTasks');
  assert.equal(child.killed, false); assert.match(harness.errorMessages.at(-1), /original task/);

  let captured;
  harness.quickPickQueue.push(items => {
    captured = items[0].entry;
    assert(Object.isFrozen(items)); assert(Object.isFrozen(items[0])); assert(Object.isFrozen(captured));
    assert.equal('child' in captured, false); assert.equal('pid' in captured, false);
    assert.throws(() => { captured.repoRoot = 'foreign-root'; }, TypeError);
    return items[0];
  }, 'Stop Selected Task');
  const run = harness.runCommand('pairofcleats.inspectTasks'); await flush(); await run;
  assert.equal(child.killed, true, 'the original item resolves to its exact still-owned process only at the stop sink');
  assert(captured.sessionId); assert.equal(harness.spawnCalls.length, 1, 'inspection/stop performs no retry');

  harness.queuedResults.push({ persistent: true });
  await harness.runCommand('pairofcleats.indexWatchStart'); await flush();
  const watch = harness.spawnCalls[1].child;
  watch.stdout.emit('data', Buffer.from(JSON.stringify({ proto: 'poc.progress@2', event: 'task:progress',
    ts: '2026-10-23T00:00:00.000Z', stage: 'parsing', current: 2, total: 5, message: 'Reading retained source' }) + '\n'));
  assert(harness.statusBarItems.some(item => /indexing/.test(item.text) && /Stage: parsing/.test(item.tooltip)
    && /Counters: 2 \/ 5/.test(item.tooltip)), 'structured stage/counters reach the registered status bar');
  const session = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
  await harness.extension._test.stopManagedCommand({ targetId: 'pairofcleats.indexWatchStart' }, { sessionId: session.sessionId });
} finally {
  await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true });
}
console.log('Registered task inspector original-item/process authority and canonical status projection authored; host acceptance separate.');
