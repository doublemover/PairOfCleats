import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { readIndexLockInfo } from '../../../src/index/build/lock.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('preprocess-cancel-lock-consumer');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
const file = path.join(repo, 'README.md'); await fs.writeFile(file, '# Source\r\nOwned preprocessing input.\r\n');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: { indexing: {
  workerPool: { enabled: false }, embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false } } });
const cacheRoot = getRepoCacheRoot(repo, loadUserConfig(repo)), originalOpen = fs.open;
let releaseRead, releaseClose, readStarted, closeStarted, building, captured = false, finished = false, closeCalls = 0;
const reading = new Promise(resolve => { readStarted = resolve; }), closing = new Promise(resolve => { closeStarted = resolve; });
const readGate = new Promise(resolve => { releaseRead = resolve; }), closeGate = new Promise(resolve => { releaseClose = resolve; });
const controller = new AbortController();
try {
  fs.open = async function (filename, ...args) {
    const handle = await originalOpen.call(this, filename, ...args);
    if (!captured && path.relative(path.resolve(String(filename)), file) === '') {
      captured = true; const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...readArgs) => { readStarted(); await readGate; return read(...readArgs); };
      handle.close = async () => { closeCalls++; closeStarted(); await closeGate; return close(); };
    }
    return handle;
  };
  building = buildIndex(repo, { mode: 'prose', stage: 'stage2', threads: 1, 'scm-provider': 'none', abortSignal: controller.signal })
    .finally(() => { finished = true; });
  const outcome = building.then(value => ({ value }), error => ({ error }));
  await Promise.race([reading, outcome.then(() => assert.fail('the actual preprocessing source read must enter its owned gate before build completion'))]);
  assert.ok(await readIndexLockInfo(cacheRoot), 'the actual build owns the index lock while preprocessing reads source');
  controller.abort(); releaseRead(); await closing;
  assert.equal(finished, false); assert.ok(await readIndexLockInfo(cacheRoot), 'cancellation cannot release the build lock while original preprocessing descriptor close is pending');
  releaseClose(); const terminal = await outcome;
  assert.ok(terminal.error?.name === 'AbortError' || terminal.error?.code === 'ABORT_ERR' || terminal.value?.cancelled === true,
    'the actual build must report canonical cancellation rather than complete success');
  assert.equal(closeCalls, 1); assert.equal(await readIndexLockInfo(cacheRoot), null);
  await assert.rejects(fs.stat(path.join(cacheRoot, 'preprocess.json')), { code: 'ENOENT' }, 'canceled/unknown counts never publish a successful preprocessing receipt');
} finally { releaseRead(); releaseClose(); if (building) await Promise.allSettled([building]); fs.open = originalOpen; await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual build preprocessing cancellation retains its index lock until the original source descriptor closes.');
