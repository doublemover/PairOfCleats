import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const fixtures = [], gates = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const make = () => {
  const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-disposal-owned-a-' });
  const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-disposal-owned-b-' });
  const harness = createVsCodeRuntimeHarness({ repoRoot: first, activeFile: path.join(first, 'src', 'app.ts'),
    workspaceFolders: [{ path: first }, { path: second }], globalConfigValues: { cliPath: path.join(first, 'bin', 'pairofcleats.js') } });
  fixtures.push({ harness, first, second }); return fixtures.at(-1);
};
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
try {
  // A native input box must receive the same cancellation authority as its
  // command, otherwise reload waits on a still-open obsolete prompt.
  const prompting = make(), entered = deferred(); let cancelled = 0, subscriptions = 0;
  prompting.harness.fakeVscode.window.showInputBox = (_options, token) => new Promise(resolve => {
    assert(token); const subscription = token.onCancellationRequested(() => {
      cancelled++; subscription.dispose(); subscriptions--; resolve(undefined);
    }); subscriptions++; entered.resolve();
  });
  prompting.harness.activate(); const search = prompting.harness.runCommand('pairofcleats.search');
  await entered.promise; const disposed = await prompting.harness.extension.deactivate(); await search;
  assert.equal(disposed.ok, true); assert.equal(cancelled, 1); assert.equal(subscriptions, 0);
  assert.equal(prompting.harness.spawnCalls.length, 0); assert.equal(prompting.harness.workspaceStateStore.has('pairofcleats.searchHistory'), false);
  prompting.harness.restoreGlobals();

  const owned = make(), { harness, first, second } = owned;
  harness.activate(); harness.queuedResults.push({ persistent: true });
  await harness.runCommand('pairofcleats.indexWatchStart'); const firstChild = harness.spawnCalls.at(-1).child;
  const firstSession = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
  harness.setActiveFile(path.join(second, 'src', 'app.ts')); harness.queuedResults.push({ persistent: true });
  await harness.runCommand('pairofcleats.indexWatchStart'); const secondChild = harness.spawnCalls.at(-1).child;
  harness.quickPickQueue.push(items => items.find(item => item.candidate?.repoRoot === first));
  await harness.runCommand('pairofcleats.selectRepo');
  assert.equal(firstChild.killed, false); assert.equal(secondChild.killed, false,
    'choosing a foreground repository preserves explicitly started background indexing');
  harness.setWorkspaceFolders([{ path: second }]); await flush();
  assert.equal(firstChild.killed, true); assert.equal(secondChild.killed, false,
    'folder removal reaps only scopes whose repository authority was removed');
  const interrupted = harness.workspaceStateStore.get('pairofcleats.workflowSessions').find(row => row.sessionId === firstSession.sessionId);
  assert.equal(interrupted.status, 'interrupted', 'revoked ownership is not recorded as successful index completion');
  assert(!harness.infoMessages.some(message => /Index Watch completed/.test(message)));
  const result = await harness.extension.deactivate(); assert.equal(result.ok, true); assert.equal(secondChild.killed, true);
  harness.restoreGlobals();

  const settling = make(); settling.harness.activate(); settling.harness.queuedResults.push({ persistent: true });
  await settling.harness.runCommand('pairofcleats.serviceApiStart');
  const child = settling.harness.spawnCalls[0].child, writeEntered = deferred(), writeGate = deferred();
  const update = settling.harness.context.workspaceState.update;
  settling.harness.context.workspaceState.update = async (key, value) => {
    if (key === 'pairofcleats.workflowSessions') { writeEntered.resolve(); await writeGate.promise; }
    return update(key, value);
  };
  child.emit('close', 0); await writeEntered.promise;
  let stopped = false; const disposal = settling.harness.extension.deactivate().then(value => { stopped = true; return value; });
  await flush(); assert.equal(stopped, false, 'child close does not release the still-owned terminal bookkeeping continuation');
  writeGate.resolve(); assert.equal((await disposal).ok, true); settling.harness.restoreGlobals();
} finally {
  for (const gate of gates) gate.resolve();
  for (const { harness, first, second } of fixtures) {
    await harness.extension.deactivate(); harness.restoreGlobals();
    for (const root of [first, second]) fs.rmSync(root, { recursive: true, force: true });
  }
}
console.log('Registered prompt cancellation, selective folder ownership and terminal settlement controls authored; execution deferred.');
