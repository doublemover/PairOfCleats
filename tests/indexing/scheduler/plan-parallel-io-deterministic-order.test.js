#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildTreeSitterSchedulerPlan } from '../../../src/index/build/tree-sitter-scheduler/plan.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'scheduler-plan-parallel-io-deterministic-order');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const fixtureFiles = [
  { rel: 'a.js', text: 'export const a = 1;\n' },
  { rel: 'b.js', text: 'export function b(x) { return x + 2; }\n' },
  { rel: 'nested/c.js', text: 'const c = () => 3;\nexport default c;\n' },
  { rel: 'nested/deeper/d.js', text: 'class D { value() { return 4; } }\nexport { D };\n' },
  { rel: 'z.js', text: 'export const z = 26;\n' }
];

for (const fixture of fixtureFiles) {
  const abs = path.join(tempRoot, fixture.rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, fixture.text, 'utf8');
}

const entries = fixtureFiles.map((fixture) => path.join(tempRoot, fixture.rel));

const createRuntime = (planIoConcurrency) => ({
  root: tempRoot,
  segmentsConfig: null,
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: true,
      scheduler: { planIoConcurrency }
    }
  }
});

const normalizePlanResult = (result) => ({
  plan: {
    schemaVersion: result?.plan?.schemaVersion || null,
    mode: result?.plan?.mode || null,
    repoRoot: result?.plan?.repoRoot || null,
    jobs: result?.plan?.jobs || 0,
    grammarKeys: Array.isArray(result?.plan?.grammarKeys) ? result.plan.grammarKeys.slice() : [],
    requiredNativeLanguages: Array.isArray(result?.plan?.requiredNativeLanguages)
      ? result.plan.requiredNativeLanguages.slice()
      : []
  },
  groups: (result?.groups || []).map((group) => ({
    grammarKey: group.grammarKey,
    languages: Array.isArray(group.languages) ? group.languages.slice() : [],
    jobs: (group.jobs || []).map((job) => ({
      virtualPath: job.virtualPath,
      grammarKey: job.grammarKey,
      runtimeKind: job.runtimeKind,
      languageId: job.languageId,
      containerPath: job.containerPath,
      containerExt: job.containerExt,
      effectiveExt: job.effectiveExt,
      segmentStart: job.segmentStart,
      segmentEnd: job.segmentEnd,
      fileVersionSignature: job.fileVersionSignature,
      segmentUid: job.segment?.segmentUid || null
    }))
  }))
});

const runPlan = async (mode, outDir, planIoConcurrency) => buildTreeSitterSchedulerPlan({
  mode,
  runtime: createRuntime(planIoConcurrency),
  entries,
  outDir,
  fileTextCache: null,
  abortSignal: null,
  log: () => {}
});

const serial = await runPlan('code', path.join(tempRoot, 'out', 'serial', 'index-code'), 1);
const parallelA = await runPlan('code', path.join(tempRoot, 'out', 'parallel-a', 'index-code'), 4);
const parallelB = await runPlan('code', path.join(tempRoot, 'out', 'parallel-b', 'index-code'), 4);

assert.ok(serial?.plan, 'expected serial scheduler plan');
assert.ok(parallelA?.plan, 'expected parallel scheduler plan');
assert.ok(parallelB?.plan, 'expected second parallel scheduler plan');

assert.deepEqual(
  normalizePlanResult(parallelA),
  normalizePlanResult(serial),
  'expected parallel planner output to match sequential output exactly'
);
assert.deepEqual(
  normalizePlanResult(parallelB),
  normalizePlanResult(parallelA),
  'expected repeated parallel planner runs to preserve deterministic ordering'
);

console.log('scheduler planner parallel I/O deterministic ordering test passed');
