import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
const [scenario, destination] = process.argv.slice(2);
assert.ok(['comparison-one', 'comparison-many', 'thread-cancellation', 'python-escaped', 'python-identifiers'].includes(scenario));
assert.ok(destination && path.isAbsolute(destination)); await fs.mkdir(destination);
const cpu = process.cpuUsage(), started = performance.now(); let report;
if (scenario.startsWith('comparison-')) {
  const { runScenario } = await import('./comparison-corpus-costs.js');
  report = await runScenario({ destination, shape: scenario === 'comparison-one' ? 'one-generation' : 'many-generations' });
} else if (scenario === 'thread-cancellation') {
  const { runScenario } = await import('./thread-cancellation-costs.js'); report = await runScenario({ destination });
} else {
  const { runScenario } = await import('./python-import-costs.js');
  report = await runScenario({ destination, scenario: scenario === 'python-escaped' ? 'escaped' : 'identifiers' });
}
await atomicWriteJson(path.join(destination, 'receipt.json'), { schemaVersion: 1, status: 'passed', scenario,
  historicalAuthorWorkspace: true, pid: process.pid, node: process.version, elapsedMs: performance.now() - started, cpu: process.cpuUsage(cpu), report }, { createOnly: true });
