#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-reuse-summary-report');
const logsRoot = path.join(tempRoot, 'logs', 'bench-language');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(logsRoot, 'run-ub050-all.log'),
  [
    '[scm] file-meta snapshot: source=cache requested=10 reused=10 fetched=0. elapsedMs=12',
    '[scm] file-meta snapshot: source=mixed requested=10 reused=8 fetched=2. elapsedMs=30',
    '[scm] file-meta snapshot: source=fresh-fallback requested=10 reused=0 fetched=10. elapsedMs=50',
    '[scm] file-meta snapshot: source=mixed-fallback requested=10 reused=5 fetched=5. elapsedMs=70 timeoutCount=2 timeoutRetries=2 cooldownSkips=1 unavailableChunks=1',
    '[tooling] provider cache read failed for pyright; using live run.',
    '[tooling] provider 1/2 done id=pyright outcome=done source=live chunks=4 elapsedMs=180.',
    '[tooling] provider 2/2 done id=gopls outcome=done source=cache chunks=6 elapsedMs=40.'
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

const reuse = output?.diagnostics?.reuse;
assert.ok(reuse && typeof reuse === 'object', 'expected reuse diagnostics summary');
assert.equal(reuse.observationCount, 7, 'expected reuse observations parsed from aggregate log');
assert.equal(reuse.countsByCause.cache_hit, 2, 'expected scm and provider cache hits');
assert.equal(reuse.countsByCause.cache_miss, 1, 'expected provider live execution to be counted as cache miss');
assert.equal(reuse.countsByCause.scm_state_prevents_reuse, 1, 'expected mixed SCM reuse classification');
assert.equal(reuse.countsByCause.provider_unavailable, 1, 'expected fresh fallback cause');
assert.equal(reuse.countsByCause.provider_unhealthy, 1, 'expected mixed fallback with timeout heat to classify as unhealthy');
assert.equal(reuse.countsByCause.cache_invalid, 1, 'expected cache read failure classification');
assert.equal(reuse.countsBySurface['scm-derived'], 4, 'expected four SCM snapshot observations');
assert.equal(reuse.countsBySurface['provider-result'], 3, 'expected three provider-result observations');
assert.equal(reuse.countsBySurfaceAndSource['scm-derived:cache'], 1);
assert.equal(reuse.countsBySurfaceAndSource['scm-derived:mixed'], 1);
assert.equal(reuse.countsBySurfaceAndSource['scm-derived:fresh-fallback'], 1);
assert.equal(reuse.countsBySurfaceAndSource['scm-derived:mixed-fallback'], 1);
assert.equal(reuse.countsBySurfaceAndSource['provider-result:live'], 2);
assert.equal(reuse.countsBySurfaceAndSource['provider-result:cache'], 1);
assert.equal(reuse.cost.timeCostMs, 382, 'expected SCM and provider elapsed time to roll up');
assert.equal(reuse.cost.requestedCount, 40, 'expected SCM requested files rolled up');
assert.equal(reuse.cost.reusedCount, 23, 'expected SCM reused files rolled up');
assert.equal(reuse.cost.fetchedCount, 17, 'expected SCM fetched files rolled up');
assert.equal(reuse.cost.chunkCount, 10, 'expected provider chunk totals rolled up');

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language reuse summary report test passed');
