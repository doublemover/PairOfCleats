import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-error-original-child-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
try {
  harness.activate(); harness.queuedResults.push({ persistent: true });
  let completed = false;
  const running = harness.runCommand('pairofcleats.indexBuild').then(value => { completed = true; return value; });
  await flush(); const child = harness.spawnCalls[0].child;
  const owned = Object.freeze({ cacheOwnershipReleased: () => false });
  const failure = Object.freeze(Object.defineProperty({}, 'message', { get() { throw owned; } }));
  child.emit('error', failure); await flush();
  assert.equal(completed, false, 'an error event is not original child close');
  await harness.runCommand('pairofcleats.indexBuild');
  assert.equal(harness.spawnCalls.length, 1, 'replacement remains excluded while the original child is retained');
  assert.match(harness.errorMessages.at(-1), /stop remains unconfirmed/);
  child.emit('close', 0); const result = await running;
  assert.equal(result.ok, false); assert.equal(result.failureEvidence.primaryError, failure);
  assert.equal(result.failureEvidence.inspectionErrors[0], owned);
  assert.equal(harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0].status, 'failed');
  assert(!harness.infoMessages.some(message => /Index Build completed/.test(message)));
  assert.equal((await harness.extension.deactivate()).ok, true, 'workflow failure and resource settlement remain independent');
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('Registered managed error retains its original child and failure through zero exit and replacement attempt; execution deferred.');
