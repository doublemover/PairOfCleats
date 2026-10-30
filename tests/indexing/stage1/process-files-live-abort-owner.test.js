import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getEventListeners } from 'node:events';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/stage1/process-files-live-abort-owner/')[1];
assert.ok(['complete', 'mid-stage-abort'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`stage1-live-listener-${selected}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo); await fs.writeFile(path.join(repo, 'input.md'), '# Actual prose input\nalpha beta gamma\n');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: { threads: 1 } });
const controller = new AbortController(), cause = new Error('exact mid-stage external abort');
let nonempty = 0, fileUpdates = 0, rejected = false;
globalThis.__stage1LiveForwarding = async (original, options) => {
  if (!options.entries?.length) return original(options);
  nonempty++;
  const unrelated = () => {};
  options.abortSignal.addEventListener('abort', unrelated);
  const baseline = getEventListeners(options.abortSignal, 'abort');
  const update = options.crashLogger.updateFile;
  options.crashLogger.updateFile = function (...args) {
    fileUpdates++; const result = update.apply(this, args);
    if (selected === 'mid-stage-abort' && !controller.signal.aborted) controller.abort(cause);
    return result;
  };
  try { return await original(options); }
  catch (error) {
    rejected = true;
    assert.equal(error.name, 'AbortError'); assert.equal(error.code, 'ABORT_ERR'); assert.equal(error.cause, cause);
    throw error;
  } finally {
    options.crashLogger.updateFile = update;
    const after = getEventListeners(options.abortSignal, 'abort');
    if (selected === 'complete') assert.deepEqual(after, baseline);
    else {
      assert.ok(after.includes(unrelated));
      assert.ok(after.every(listener => baseline.includes(listener)), 'abort may consume preexisting once listeners, but cannot leave a new Stage1 listener');
    }
    options.abortSignal.removeEventListener('abort', unrelated);
  }
};
const hooks = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith('/src/index/build/indexer/steps/process-files.js')) return loaded;
  const original = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
  const source = original.replace('export const processFiles = options =>', 'const originalProcessFiles = options =>');
  assert.notEqual(source, original);
  return { ...loaded, source: source + '\nexport const processFiles=options=>globalThis.__stage1LiveForwarding(originalProcessFiles,options);\n' };
} });
try {
  const { buildIndex } = await import('../../../src/integrations/core/build-index.js');
  const build = buildIndex(repo, { mode: 'prose', stage: 'stage1', threads: 1, abortSignal: controller.signal, log() {} });
  if (selected === 'complete') await build;
  else await assert.rejects(build, error => error.name === 'AbortError' || error.cause?.name === 'AbortError');
  assert.ok(nonempty > 0 && fileUpdates > 0, 'the original public Stage1 processes an actual input file');
  assert.equal(rejected, selected === 'mid-stage-abort');
  assert.deepEqual(getEventListeners(controller.signal, 'abort'), []);
  controller.abort(cause);
  assert.deepEqual(getEventListeners(controller.signal, 'abort'), []);
} finally { hooks.deregister(); delete globalThis.__stage1LiveForwarding; await fs.rm(dir, { recursive: true, force: true }); }
console.log(`Actual nonempty Stage1 ${selected} preserves external listener and cancellation ownership.`);
