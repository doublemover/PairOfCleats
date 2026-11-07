import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-semantic-retirement-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
const generation = { baseBuildId: 'retirement-generation', semanticRevision: 0 };
const primary = Object.freeze({ message: 'semantic request file remains retained', storageOwnershipReleased: () => false });
const originalUnlink = fs.unlinkSync;
let retainedPath = '';
try {
  harness.activate();
  harness.inputQueue.push(generation.baseBuildId);
  harness.quickPickQueue.push(items => items.find(item => item.value === 'manual'), 'Selected chunk ownership');
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ generation, status: 'partial', records: [], edges: [], frontier: [] }) });
  fs.unlinkSync = function(file, ...args) {
    if (String(file).startsWith(harness.context.globalStorageUri.fsPath) && path.basename(file) === 'request.json') {
      retainedPath = String(file); throw primary;
    }
    return originalUnlink(file, ...args);
  };
  const evidence = await harness.runCommand('pairofcleats.semanticEvidence', { resultSet: { repoRoot: root }, hit: { chunkUid: 'selected' } });
  fs.unlinkSync = originalUnlink;
  assert.equal(evidence.primaryError, primary);
  assert.equal(fs.existsSync(retainedPath), true);
  assert.equal(primary.storageOwnershipReleased(), false);
  assert(!harness.openedDocuments.some(document => String(document.uri?.content || '').includes('Generation: retirement-generation')),
    'a successful semantic child cannot publish success after its original request retirement failed');
  const shutdown = await harness.extension.deactivate();
  assert.equal(shutdown.ok, false); assert.equal(shutdown.retainedOwners, 1);
  assert(shutdown.failureEvidence.failures.some(failure => failure.primaryError === primary));
} finally {
  fs.unlinkSync = originalUnlink; harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true });
}
console.log('Registered semantic request retirement retains the exact failed file owner and original error; execution deferred.');
