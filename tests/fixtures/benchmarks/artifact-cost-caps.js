import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
const [scenario, destination] = process.argv.slice(2);
assert.ok(['stats', 'columnar', 'coverage', 'manifest', 'filter', 'probe'].includes(scenario));
assert.ok(destination && path.isAbsolute(destination)); await fs.mkdir(destination);
const { runScenario } = await import('./artifact-' + scenario + '-costs.js');
const cpu = process.cpuUsage(), started = performance.now();
const report = await runScenario({ destination });
await atomicWriteJson(path.join(destination, 'receipt.json'), { schemaVersion: 1, status: 'passed', scenario,
  historicalAuthorWorkspace: true, pid: process.pid, node: process.version,
  elapsedMs: performance.now() - started, cpu: process.cpuUsage(cpu), report }, { createOnly: true });
