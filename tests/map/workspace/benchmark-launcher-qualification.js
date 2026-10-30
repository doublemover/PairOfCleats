import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';

// Explicit serial qualification capsule. Browser prerequisites are supplied by
// its caller; ordinary CI discovery does not execute or skip this helper.
const options = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) =>
  [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
for (const key of ['playwright', 'chromium', 'scenario', 'out']) if (!options[key]) throw new Error(`Required --${key}`);
const scenario = options.scenario;
assert.ok(['fps', 'lod'].includes(scenario));
const playwright = path.resolve(options.playwright), chromium = path.resolve(options.chromium);
await requireBootstrap();
await fs.access(playwright); await fs.access(chromium);
if (options.worker !== 'true') {
  const result = await spawnSubprocess(process.execPath, [fileURLToPath(import.meta.url),
    ...process.argv.slice(2), '--worker', 'true'], { timeoutMs: 30000, maxOutputBytes: 1024 * 1024,
    captureStdout: true, captureStderr: true, outputMode: 'string', rejectOnNonZeroExit: true, killTree: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(0);
}
const { dir } = await prepareIsolatedTestCacheDir(`benchmark-browser-${scenario}`), repo = path.join(dir, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'main.js'), 'function first() { return second(); }\nfunction second() { return 2; }\n');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
    indexing: { workerPool: { maxWorkers: 1 }, embeddings: { enabled: false, mode: 'off' } } }) });
const controller = new AbortController();
let child, readyTimer, pending = '', readiness, intentionalAbort = false;
let primary, failed = false;
let resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
const output = path.resolve(options.out);
try {
  await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, sqlite: false, 'scm-provider': 'none', progress: 'off' });
  readyTimer = setTimeout(() => rejectReady(new Error('Actual benchmark launcher did not reach module-graph readiness within 15 seconds.')), 15000);
  const entry = scenario === 'fps' ? 'viewer-fps.js' : 'viewer-lod-stress.js';
  child = spawnSubprocess(process.execPath, [`tools/bench/map/${entry}`, '--repo', repo, '--port', '0',
    '--out', path.join(dir, `${scenario}.html`)], { signal: controller.signal, timeoutMs: 30000, maxOutputBytes: 256 * 1024,
    captureStdout: true, captureStderr: true, outputMode: 'string', killTree: true,
    onStderr(chunk) {
      pending += chunk;
      while (pending.includes('\n')) {
        const end = pending.indexOf('\n'), line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (!line.startsWith('{')) continue;
        try {
          const value = JSON.parse(line);
          if (value.kind === 'map-benchmark-readiness') { readiness = value; resolveReady(value); }
        } catch { /* Human diagnostics are retained in the bounded child capture. */ }
      }
    }
  });
  void child.then(result => rejectReady(Object.assign(new Error('Benchmark listener exited before qualification.'), { result })), rejectReady);
  await ready; clearTimeout(readyTimer);
  assert.equal(readiness.scenario, scenario); assert.equal(readiness.stages.moduleGraph.state, 'module-graph-ready');
  assert.equal(readiness.stages.viewer.state, 'not-run'); assert.equal(readiness.fps, 'not-measured');
  const qualified = await spawnSubprocess(process.execPath, ['tests/map/workspace/benchmark-browser-qualification.js',
    '--url', readiness.url, '--playwright', playwright, '--chromium', chromium, '--out', output, '--scenario', scenario], {
    timeoutMs: 20000, maxOutputBytes: 1024 * 1024, captureStdout: true, captureStderr: true,
    outputMode: 'string', rejectOnNonZeroExit: true, killTree: true });
  assert.equal(qualified.outputCapture.stdout.truncated, false);
  await fs.writeFile(path.join(output, 'launcher-readiness.json'), JSON.stringify({ historicalAuthorWorkspace: true, readiness }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ scenario, browserQualification: output, launcher: readiness }));
} catch (error) { failed = true; primary = error; throw error; }
finally {
  clearTimeout(readyTimer);
  if (child) {
    intentionalAbort = true; controller.abort();
    try { await child; }
    catch (error) {
      try {
        observeStorageResource(error, { phase: 'benchmark-browser-listener-cleanup' }).requireSettled();
        if (!intentionalAbort || error.code !== 'ABORT_ERR') throw error;
      } catch (cleanup) {
        if (failed) throw addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true });
        throw cleanup;
      }
    }
  }
  try { await fs.rm(dir, { recursive: true, force: true }); }
  catch (error) { if (failed) throw addStorageFailureContext(primary, {}, error, { secondaryPresent: true }); throw error; }
}
