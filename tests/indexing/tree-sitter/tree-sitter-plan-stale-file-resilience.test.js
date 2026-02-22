#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildTreeSitterSchedulerPlan } from '../../../src/index/build/tree-sitter-scheduler/plan.js';
import { executeTreeSitterSchedulerPlan } from '../../../src/index/build/tree-sitter-scheduler/executor.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { skipIfNativeGrammarsUnavailable } from './native-availability.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'tree-sitter-plan-stale-file-resilience');
const sourcePath = path.join(tempRoot, 'sample.js');
const outDir = path.join(tempRoot, 'out', 'index-code');
if (skipIfNativeGrammarsUnavailable(['javascript'], 'tree-sitter scheduler stale-plan resilience')) {
  process.exit(0);
}

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(sourcePath, 'export const value = 1;\n', 'utf8');

const runtime = {
  root: tempRoot,
  segmentsConfig: null,
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: true
    }
  }
};

const planResult = await buildTreeSitterSchedulerPlan({
  mode: 'code',
  runtime,
  entries: [sourcePath],
  outDir,
  abortSignal: null,
  log: () => {}
});

assert.ok(planResult?.plan, 'expected scheduler plan');
assert.ok(planResult.plan.jobs > 0, 'expected scheduler plan to include at least one job');
assert.ok(planResult.groups.length > 0, 'expected scheduler plan groups');

await fs.writeFile(sourcePath, 'export const value = 2;\n', 'utf8');

let stalePlanError = null;
try {
  await executeTreeSitterSchedulerPlan({
    mode: 'code',
    runtime,
    groups: planResult.groups,
    outDir,
    abortSignal: null,
    log: () => {}
  });
} catch (err) {
  stalePlanError = err;
}

assert.ok(stalePlanError, 'expected stale plan failure after source mutation');
assert.match(
  String(stalePlanError?.message || ''),
  /stale plan/i,
  'expected stale plan error message'
);

console.log('tree-sitter scheduler stale-plan resilience ok');
