import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const repoRoot = createVsCodeRuntimeTempRepo({ prefix: 'poc-search-continuation-' });
const harness = createVsCodeRuntimeHarness({ repoRoot, activeFile: path.join(repoRoot, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(repoRoot, 'bin', 'pairofcleats.js') },
  configValues: { searchMode: 'code', searchModifiedSince: '0', searchBackend: 'sqlite' } });
const page = (id, hasMore) => ({ code: [{ file: 'src/app.ts', id, startLine: 1 }], pagination: {
  kind: 'filter', generation: 'a'.repeat(64), order: 'indexed-order', returned: 1, total: 2,
  hasMore, nextCursor: hasMore ? 'opaque-cursor' : null, coverage: 'indexed-metadata' } });
try {
  harness.activate(); harness.inputQueue.push('lang:typescript'); harness.quickPickQueue.push(null);
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify(page(1, true)) });
  await harness.runCommand('pairofcleats.browseIndexedMatches');
  const original = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0];
  harness.setConfiguration({ searchMode: 'prose', searchModifiedSince: '14', searchFilter: 'file:changed.ts' });
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify(page(2, false)) });
  await harness.runCommand('pairofcleats.loadMoreResults');
  assert.equal(harness.spawnCalls.length, 2);
  const nextArgs = harness.spawnCalls.at(-1).args;
  assert.equal(nextArgs[nextArgs.indexOf('--filter') + 1], 'lang:typescript');
  assert.equal(nextArgs[nextArgs.indexOf('--modified-since') + 1], '0');
  assert.equal(nextArgs[nextArgs.indexOf('--mode') + 1], 'code');
  assert.equal(nextArgs[nextArgs.indexOf('--cursor') + 1], 'opaque-cursor');
  const merged = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0];
  assert.equal(merged.resultSetId, original.resultSetId);
  assert.equal(merged.hits.length, 2);
  assert.equal(merged.invocation.request.options.cursor, undefined, 'base query replay remains a deliberate restart, not the last page');
  assert.deepEqual(harness.errorMessages, []);
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(repoRoot, { recursive: true, force: true }); }
console.log('Registered indexed continuation preserves semantic filters, typed zero and opaque cursor; execution deferred.');
