#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-process-reuse-classification');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const masterLogPath = path.join(tempRoot, 'run-all.log');
const runner = createProcessRunner({
  appendLog: () => {},
  writeLog: () => {},
  writeLogSync: () => {},
  logHistory: [],
  logPath: masterLogPath,
  getLogPaths: () => [masterLogPath],
  onProgressEvent: () => {}
});

const script = [
  "console.log('[scm] file-meta snapshot: source=mixed-fallback requested=12 reused=7 fetched=5. elapsedMs=240 timeoutCount=2 timeoutRetries=1 cooldownSkips=1 unavailableChunks=1');",
  "console.log('[tooling] provider cache read failed for pyright; using live run.');",
  "console.log('[tooling] provider 1/1 done id=pyright outcome=done source=live chunks=4 elapsedMs=180.');",
  'process.exit(0);'
].join('');

const result = await runner.runProcess(
  'ub050-reuse',
  process.execPath,
  ['-e', script],
  { continueOnError: true }
);

assert.equal(result.ok, true, 'expected subprocess success');
assert.equal(result.diagnostics?.countsByType?.fallback_used, 2, 'expected structured fallback events only for SCM fallback and cache invalidation');

const diagnosticsPath = path.join(tempRoot, 'run-all.diagnostics.jsonl');
const events = (await fsPromises.readFile(diagnosticsPath, 'utf8'))
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

assert.equal(events.length, 2, 'expected only two persisted fallback diagnostics');

const scmFallback = events.find((entry) => entry.reuseSurface === 'scm-derived');
assert.ok(scmFallback, 'expected SCM fallback event');
assert.equal(scmFallback.failureClass, 'provider_unhealthy');
assert.equal(scmFallback.reuseSource, 'mixed-fallback');
assert.equal(scmFallback.qualityImpact, 'partial-provider-fidelity');
assert.equal(scmFallback.timeCostMs, 240);
assert.equal(scmFallback.requestedCount, 12);
assert.equal(scmFallback.reusedCount, 7);
assert.equal(scmFallback.fetchedCount, 5);

const providerCacheFallback = events.find((entry) => entry.reuseSurface === 'provider-result');
assert.ok(providerCacheFallback, 'expected provider-result cache invalidation fallback event');
assert.equal(providerCacheFallback.failureClass, 'cache_invalid');
assert.equal(providerCacheFallback.reuseSource, 'live');
assert.equal(providerCacheFallback.qualityImpact, 'none');

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language process reuse classification test passed');
