import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { setProgressHandlers } from '../../../src/shared/progress-runtime.js';

const cases = ['nonzero', 'absent', 'negative'];
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./scm-wait-watchdog-consumer.test.js.cases.json', import.meta.url))), { schemaVersion: 1, cases });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/stage1/scm-wait-watchdog-consumer/')[1];
assert.ok(cases.includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`scm-wait-watchdog-${selected}`), repo = path.join(dir, 'repo'); await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'README.md'), '# Queue wait\nOne ordinary paragraph.\n');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: createFastIndexingTestConfig({ threads: 1,
  sqlite: { use: false }, indexing: { workerPool: { enabled: false }, embeddings: { enabled: false },
    stage1: { watchdog: { slowFileMs: 1000, maxSlowFileMs: 1000, nearThresholdMinSamples: 1 } } } }),
extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const now = Date.now, timeout = globalThis.setTimeout;
let watchdog = null, stageClock = null, near = null, bodyObserved = false;
const logs = [], restore = setProgressHandlers({ logLine: (message, meta) => logs.push({ message, meta }), log() {}, showProgress() {} });
globalThis.setTimeout = (callback, delay, ...args) => {
  if (delay === 1000 && callback.toString().includes('[watchdog] slow file')) watchdog = callback;
  return timeout(callback, delay, ...args);
};
globalThis.__scmWatchdog = { async run(actual, entry, index, context) {
  bodyObserved = true; assert.ok(watchdog, 'the real Stage1 caller owns the armed slow-file callback');
  const base = now(); stageClock = base + 1300; Date.now = () => stageClock;
  if (selected !== 'absent') context.onScmProcQueueWait(selected === 'nonzero' ? 650 : -5);
  watchdog();
  const result = await actual(entry, index, context); stageClock = base + 1550;
  return result;
}, observe(input) { near = input.buildStageTimingBreakdownPayload().watchdog.nearThreshold; Date.now = now; } };
const hook = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (url.endsWith('/src/index/build/file-processor.js')) {
    return { ...loaded, source: Buffer.from(loaded.source).toString().replace('export function createFileProcessor(', 'function actualCreateFileProcessor(')
      + `\nexport function createFileProcessor(options){const owned=actualCreateFileProcessor(options);const actual=owned.processFile;
        return {...owned,processFile:(...args)=>globalThis.__scmWatchdog.run(actual,...args)};}` };
  }
  if (url.endsWith('/process-files/results.js')) return { ...loaded,
    source: Buffer.from(loaded.source).toString().replace('export const finalizeStage1ProcessingResult =', 'const actualFinalizeStage1ProcessingResult =')
      + `\nexport const finalizeStage1ProcessingResult=async input=>{globalThis.__scmWatchdog.observe(input);return actualFinalizeStage1ProcessingResult(input)};` };
  return loaded;
} });
try {
  const { buildIndex } = await import('../../../src/integrations/core/build-index/index.js');
  await buildIndex(repo, { mode: 'prose', stage: 'stage1', threads: 1, sqlite: false, 'scm-provider': 'none' });
  assert.equal(bodyObserved, true); assert.ok(near);
  const warnings = logs.filter(row => row.meta?.kind === 'file-watchdog');
  assert.equal(warnings.length, selected === 'nonzero' ? 0 : 1);
  assert.equal(near.nearThresholdCount, selected === 'nonzero' ? 1 : 0);
  if (warnings.length) { assert.equal(warnings[0].meta.scmProcQueueWaitMs, 0); assert.ok(warnings[0].meta.activeDurationMs >= 1300); }
} finally { Date.now = now; globalThis.setTimeout = timeout; restore(); hook.deregister(); delete globalThis.__scmWatchdog; }
console.log(JSON.stringify({ selected, near, warningCount: logs.filter(row => row.meta?.kind === 'file-watchdog').length }));
