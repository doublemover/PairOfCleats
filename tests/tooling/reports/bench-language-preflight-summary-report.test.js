#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-preflight-summary-report');
const logsRoot = path.join(tempRoot, 'logs', 'bench-language');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(logsRoot, 'run-preflight-a.log'),
  [
    '[tooling] preflight:start provider=sourcekit id=sourcekit.package-resolution class=dependency timeoutMs=90000',
    '[tooling] preflight:ok provider=sourcekit id=sourcekit.package-resolution durationMs=1234 state=ready',
    '[tooling] preflight:queued provider=gopls id=gopls.workspace-model class=workspace depth=1 running=1 cap=1',
    '[tooling] preflight:timeout provider=gopls id=gopls.workspace-model durationMs=60000 state=degraded timeout=1',
    '[tooling] preflight summary total=4 cached=0 timedOut=1 failed=0 queuePeak=2 teardownTimedOut=0 states=ready:1,degraded:1 classes=dependency:1,workspace:1 policies=required:1,optional:1',
    '[tooling] preflight slowest gopls/gopls.workspace-model:60000ms, sourcekit/sourcekit.package-resolution:1234ms'
  ].join('\n') + '\n',
  'utf8'
);

await fsPromises.writeFile(
  path.join(logsRoot, 'run-preflight-b.log'),
  [
    '[tooling] preflight:failed provider=rust-analyzer id=rust-analyzer.workspace-model durationMs=912 error=forced',
    '[tooling] preflight:cache_hit provider=sourcekit id=sourcekit.package-resolution state=ready'
  ].join('\n') + '\n',
  'utf8'
);

const output = await buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: tempRoot,
  results: [],
  config: {}
});

const preflight = output?.diagnostics?.preflight;
assert.ok(preflight && typeof preflight === 'object', 'expected preflight diagnostics summary');
assert.equal(preflight.fileCount, 2, 'expected two bench log files');
assert.equal(preflight.eventCount, 6, 'expected parsed preflight event count');
assert.equal(preflight.timeoutEvents, 1, 'expected one timeout event');
assert.equal(preflight.countsByEvent.start, 1, 'expected start count');
assert.equal(preflight.countsByEvent.ok, 1, 'expected ok count');
assert.equal(preflight.countsByEvent.failed, 1, 'expected failed count');
assert.equal(preflight.countsByEvent.cache_hit, 1, 'expected cache-hit count');
assert.equal(preflight.countsByClass.dependency, 1, 'expected dependency class count');
assert.equal(preflight.countsByClass.workspace, 1, 'expected workspace class count');
assert.equal(preflight.countsByClass.unknown, 4, 'expected unknown class count when class is not logged');
assert.equal(preflight.countsByState.ready, 2, 'expected ready state count');
assert.equal(preflight.countsByState.degraded, 1, 'expected degraded state count');
assert.equal(preflight.countsByState.failed, 1, 'expected failed state count');
assert.equal(preflight.topSlow[0]?.durationMs, 60000, 'expected top slow preflight event by duration');
assert.equal(preflight.summary?.lineCount, 1, 'expected one preflight summary line');
assert.equal(preflight.summary?.maxQueuePeak, 2, 'expected max queue peak from summary line');
assert.equal(preflight.summary?.teardownTimedOutCount, 0, 'expected no teardown timeout summaries');
assert.equal(preflight.summary?.countsByClass?.dependency, 1, 'expected summary class aggregation');
assert.equal(preflight.summary?.countsByState?.degraded, 1, 'expected summary state aggregation');
assert.equal(preflight.summary?.countsByPolicy?.required, 1, 'expected summary policy aggregation');
assert.equal(preflight.summary?.countsByPolicy?.optional, 1, 'expected summary policy aggregation');
assert.equal(preflight.summary?.topSlow?.[0]?.durationMs, 60000, 'expected parsed summary slowest duration');
assert.equal(preflight.summary?.topSlow?.[0]?.providerId, 'gopls', 'expected parsed summary slowest provider');

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language preflight summary report test passed');
