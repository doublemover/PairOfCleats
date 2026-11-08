import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const require = createRequire(import.meta.url);
const { DEFAULT_MAX_BUFFER_BYTES, getApiResponseCleanupOwner } = require('../../../extensions/vscode/runtime.js');
const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-response-cleanup-owner-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root, globalConfigValues: {
  cliPath: path.join(root, 'bin', 'pairofcleats.js'), apiExecutionMode: 'prefer', apiServerUrl: 'http://127.0.0.1:4311' } });
const cleanup = Object.freeze({ message: 'controlled underlying response cancellation rejection', cacheOwnershipReleased: () => false });
let cancellations = 0, reads = 0;
try {
  harness.activate();
  globalThis.fetch = async () => ({ ok: true, status: 200,
    headers: new Headers({ 'content-length': String(DEFAULT_MAX_BUFFER_BYTES + 1) }),
    body: { async cancel() { cancellations++; throw cleanup; },
      getReader() { reads++; assert.fail('credible oversized identity length must not read response chunks'); } } });
  await harness.runCommand('pairofcleats.search');
  assert.equal(harness.spawnCalls.length, 0, 'prefer mode cannot fall back while its original API response cleanup is unconfirmed');
  assert.equal(harness.workspaceStateStore.has('pairofcleats.searchHistory'), false);
  assert.equal(cancellations, 1); assert.equal(reads, 0);
  assert.match(harness.errorMessages.at(-1), /cleanup remains unconfirmed/);
  const shutdown = await harness.extension.deactivate();
  assert.equal(shutdown.ok, false); assert.equal(shutdown.retainedOwners, 1);
  assert(shutdown.failureEvidence.failures.some(failure => failure.primaryError === cleanup));
  assert.equal(cleanup.cacheOwnershipReleased(), false);
  assert.equal(getApiResponseCleanupOwner({ kind: 'api-response-cleanup-unconfirmed', failureEvidence: shutdown.failureEvidence }), undefined,
    'copied public diagnostics cannot manufacture original response ownership');
} finally { harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('Registered API probe retains rejected original response cancellation and refuses successful CLI fallback/shutdown; execution deferred.');
