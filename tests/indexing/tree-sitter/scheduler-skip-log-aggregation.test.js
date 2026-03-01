#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildTreeSitterSchedulerPlan } from '../../../src/index/build/tree-sitter-scheduler/plan.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tree-sitter-scheduler-skip-log-aggregation');
const outDir = path.join(tempRoot, 'out');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const entries = ['a.min.js', 'b.min.js', 'c.min.js'].map((name) => path.join(tempRoot, name));
for (const filePath of entries) {
  await fs.writeFile(filePath, 'export const value = 1;\n', 'utf8');
}

const logLines = [];
const result = await buildTreeSitterSchedulerPlan({
  mode: 'code',
  runtime: {
    root: tempRoot,
    segmentsConfig: {},
    languageOptions: {
      skipOnParseError: true,
      treeSitter: {
        enabled: true,
        strict: false,
        scheduler: {
          skipLogSampleLimit: 1
        }
      }
    }
  },
  entries,
  outDir,
  log: (line) => logLines.push(String(line))
});

assert.ok(result?.plan, 'expected scheduler plan result');
assert.equal(result.plan.jobs, 0, 'expected all minified files to be skipped');

const minifiedSampleLines = logLines.filter((line) => (
  /\[tree-sitter:schedule\] skip .*: minified/i.test(line)
));
assert.equal(minifiedSampleLines.length, 1, 'expected minified skip samples to be rate-limited');

assert.ok(
  logLines.some((line) => /skip summary minified: 3 total \(1 sampled, 2 suppressed\)/i.test(line)),
  'expected minified skip summary line with aggregated counts'
);

console.log('tree-sitter scheduler skip-log aggregation test passed');
