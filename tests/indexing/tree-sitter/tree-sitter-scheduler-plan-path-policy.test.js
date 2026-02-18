#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildTreeSitterSchedulerPlan } from '../../../src/index/build/tree-sitter-scheduler/plan.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'tree-sitter-scheduler-plan-path-policy', 'index-code');
const fixtureDir = path.join(root, '.testCache', 'tree-sitter-scheduler-plan-path-policy', 'fixtures');
const infraAbs = path.join(fixtureDir, 'workflow.yml');
const vendorAbs = path.join(fixtureDir, 'json.hpp');
const swiftHeavyAbs = path.join(fixtureDir, 'swift-heavy.swift');
const opencvHeavyAbs = path.join(fixtureDir, 'opencv-heavy.hpp');
const jsHeavyAbs = path.join(fixtureDir, 'opencv-heavy.js');
const jsAbs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');

await fs.rm(path.join(root, '.testCache', 'tree-sitter-scheduler-plan-path-policy'), { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(fixtureDir, { recursive: true });
await fs.writeFile(infraAbs, 'name: CI\non: push\n', 'utf8');
await fs.writeFile(vendorAbs, '#pragma once\nnamespace nlohmann {}\n', 'utf8');
await fs.writeFile(swiftHeavyAbs, 'public struct X { public init() {} }\n', 'utf8');
await fs.writeFile(opencvHeavyAbs, '#pragma once\nnamespace cv { namespace hal {} }\n', 'utf8');
await fs.writeFile(jsHeavyAbs, 'export const perf = () => 1;\n', 'utf8');

const runtime = {
  root,
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
  entries: [
    { abs: infraAbs, rel: '.github/workflows/ci.yml', ext: '.yml' },
    { abs: vendorAbs, rel: 'include/nlohmann/json.hpp', ext: '.hpp' },
    { abs: swiftHeavyAbs, rel: 'test/api-digester/Inputs/SDK.swift', ext: '.swift' },
    { abs: opencvHeavyAbs, rel: 'modules/core/include/opencv2/core/hal/intrin.hpp', ext: '.hpp' },
    { abs: jsHeavyAbs, rel: 'modules/js/perf/measure.js', ext: '.js' },
    { abs: jsAbs, rel: 'tests/fixtures/tree-sitter/javascript.js', ext: '.js' }
  ],
  outDir,
  fileTextCache: null,
  abortSignal: null,
  log: () => {}
});

assert.ok(planResult && Array.isArray(planResult.groups), 'expected scheduler plan groups');
const allJobs = planResult.groups.flatMap((group) => group.jobs || []);
assert.ok(allJobs.length > 0, 'expected at least one planned job');
assert.ok(
  allJobs.some((job) => job.containerPath === 'tests/fixtures/tree-sitter/javascript.js'),
  'expected normal js fixture to remain scheduled'
);
assert.ok(
  !allJobs.some((job) => job.containerPath === '.github/workflows/ci.yml'),
  'expected infra workflow path to be excluded from scheduler plan'
);
assert.ok(
  !allJobs.some((job) => job.containerPath === 'include/nlohmann/json.hpp'),
  'expected heavy vendor include path to be excluded from scheduler plan'
);
assert.ok(
  !allJobs.some((job) => job.containerPath === 'test/api-digester/Inputs/SDK.swift'),
  'expected heavy swift test fixture path to be excluded from scheduler plan'
);
assert.ok(
  !allJobs.some((job) => job.containerPath === 'modules/core/include/opencv2/core/hal/intrin.hpp'),
  'expected heavy opencv hal path to be excluded from scheduler plan'
);
assert.ok(
  !allJobs.some((job) => job.containerPath === 'modules/js/perf/measure.js'),
  'expected heavy opencv js perf path to be excluded from scheduler plan'
);

console.log('tree-sitter scheduler plan path policy ok');
