#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingPass } from '../../../src/index/type-inference-crossfile/tooling.js';
import { registerToolingProvider, TOOLING_PROVIDERS } from '../../../src/index/tooling/provider-registry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { resolveBenchmarkToolingLogs } from '../../../tools/bench/language/tooling-logs.js';
import { getToolingConfig } from '../../../tools/shared/dict-utils.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-diagnostic-retention-${process.pid}-${Date.now()}`);
const savedProviders = new Map(TOOLING_PROVIDERS);
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'src/sample.js'), 'function sum(a, b) { return a + b; }\n');
const logs = [];
const makeChunks = () => [{ file: 'src/sample.js', name: 'sum', kind: 'function', lang: 'javascript',
  ext: '.js', chunkUid: 'chunk-1', start: 0, end: 33, docmeta: {}, metaV2: { symbol: { qualifiedName: 'sum' } } }];
const entryByUid = new Map([['chunk-1', { name: 'sum', file: 'src/sample.js', kind: 'function',
  chunkUid: 'chunk-1', qualifiedName: 'sum', paramTypes: {} }]]);
registerToolingProvider({ id: 'retention-fixture', version: '1.0.0', kinds: ['types'],
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'retention-fixture-v1', async run() {
    return { byChunkUid: { 'chunk-1': { returnType: 'number' } }, diagnostics: {
      checks: [{ name: 'fixture_workspace_model', status: 'warn', message: 'Fixture workspace has no module marker.' }],
      fidelity: { state: 'degraded', semanticCoverage: { state: 'partial' } },
      runtime: { requests: { byMethod: { 'textDocument/hover': { requests: 3, timedOut: 1 } } } }
    } };
  } });
const run = (toolingLogDir, log, cacheEnabled = false) => runToolingPass({ rootDir: tempRoot, buildRoot: tempRoot,
  chunks: makeChunks(), entryByUid, log, toolingConfig: { enabledTools: ['retention-fixture'],
    cache: { enabled: cacheEnabled }, doctorCache: false }, toolingTimeoutMs: 2000, toolingRetries: 0,
  toolingBreaker: 1, toolingLogDir,
  fileTextByFile: new Map([['src/sample.js', 'function sum(a, b) { return a + b; }\n']]) });
try {
  const disposableCache = path.join(tempRoot, 'isolated-cache');
  await fs.mkdir(disposableCache);
  const benchmarkLogs = resolveBenchmarkToolingLogs({ receiptPath: path.join(tempRoot, 'results', 'checkout', 'receipt.json') });
  const logDir = await withTemporaryEnv({ PAIROFCLEATS_TOOLING_LOG_DIR: benchmarkLogs.dir }, () => getToolingConfig(tempRoot, {}).logDir);
  const result = await run(logDir, (line) => logs.push(line));
  assert.ok(result.toolingProvidersExecuted > 0);
  assert.ok(logs.some((line) => line.includes('fixture_workspace_model: Fixture workspace has no module marker.')));
  const retained = (await fs.readFile(path.join(logDir, 'tooling.log'), 'utf8')).split('\n')
    .filter((line) => line.includes('[tooling-diagnostic] '))
    .map((line) => JSON.parse(line.split('[tooling-diagnostic] ')[1]));
  const record = retained.find((entry) => entry.providerId === 'retention-fixture');
  assert.ok(record, 'actual pass flushes parseable diagnostic details before closing');
  assert.equal(record.checks[0].name, 'fixture_workspace_model');
  assert.equal(record.providerContractVersion, '1.0.0');
  assert.equal(record.diagnosticsSource, 'live');
  assert.equal(record.runtime.requests.byMethod['textDocument/hover'].timedOut, 1);
  await fs.rm(disposableCache, { recursive: true });
  assert.ok((await fs.stat(path.join(logDir, 'tooling.log'))).isFile(), 'benchmark diagnostic evidence survives isolated-cache cleanup');
  await run(logDir, () => {}, true);
  const cachedLogs = [];
  await run(logDir, (line) => cachedLogs.push(line), true);
  const cached = (await fs.readFile(path.join(logDir, 'tooling.log'), 'utf8')).split('\n')
    .filter((line) => line.includes('[tooling-diagnostic] '))
    .map((line) => JSON.parse(line.split('[tooling-diagnostic] ')[1])).at(-1);
  assert.equal(cached.diagnosticsSource, 'cache-suppressed');
  assert.equal(cached.checks[0].name, 'fixture_workspace_model');
  assert.equal(cached.runtime, null);
  assert.ok(!cachedLogs.some((line) => line.includes('fixture_workspace_model:')),
    'reused diagnostic evidence does not generate fresh live-request warning events');
  const invalidLogDir = path.join(tempRoot, 'not-a-directory');
  await fs.writeFile(invalidLogDir, 'inert fixture');
  const failedWriteLogs = [];
  const withFailedLog = await run(invalidLogDir, (line) => failedWriteLogs.push(line));
  assert.ok(withFailedLog.toolingProvidersExecuted > 0, 'log failure preserves valid provider output');
  assert.equal(failedWriteLogs.filter((line) => line.includes('diagnostic log open failed')).length, 1);
  assert.ok(failedWriteLogs.some((line) => line.includes('fixture_workspace_model: Fixture workspace has no module marker.')),
    'actual cause remains visible if the artifact cannot be written');
  console.log('Actual tooling pass retains cause/counters and flushes its artifact; write failure stays explicit and preserves output.');
} finally {
  TOOLING_PROVIDERS.clear();
  for (const [id, provider] of savedProviders) TOOLING_PROVIDERS.set(id, provider);
  await fs.rm(tempRoot, { recursive: true, force: true });
}
