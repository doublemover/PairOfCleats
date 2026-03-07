#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildTreeSitterSchedulerPlan } from '../../../src/index/build/tree-sitter-scheduler/plan.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tree-sitter-scheduler-plan-skip-on-parse-error');
const sourcePath = path.join(tempRoot, 'sample.js');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.writeFile(sourcePath, 'export const ok = true;\n', 'utf8');

const throwingSegmentsConfig = {};
Object.defineProperty(throwingSegmentsConfig, 'cdc', {
  enumerable: true,
  configurable: true,
  get() {
    throw new Error('forced-segments-config-error');
  }
});

const createRuntime = (skipOnParseError) => ({
  root: tempRoot,
  segmentsConfig: throwingSegmentsConfig,
  languageOptions: {
    skipOnParseError,
    treeSitter: {
      enabled: true,
      strict: false
    }
  }
});

const outDirFatal = path.join(tempRoot, 'out-fatal');
let fatalError = null;
try {
  await buildTreeSitterSchedulerPlan({
    mode: 'code',
    runtime: createRuntime(false),
    entries: [sourcePath],
    outDir: outDirFatal,
    log: () => {}
  });
} catch (err) {
  fatalError = err;
}
assert.ok(fatalError, 'expected scheduler plan to throw when skipOnParseError is disabled');
assert.match(
  String(fatalError?.message || ''),
  /segment discovery failed/i,
  'expected segment discovery failure message'
);

const outDirSkip = path.join(tempRoot, 'out-skip');
const logLines = [];
const skipped = await buildTreeSitterSchedulerPlan({
  mode: 'code',
  runtime: createRuntime(true),
  entries: [sourcePath],
  outDir: outDirSkip,
  log: (line) => logLines.push(line)
});

assert.ok(skipped?.plan, 'expected scheduler plan result when skipOnParseError is enabled');
assert.equal(skipped.plan.jobs, 0, 'expected no scheduler jobs after parse error skip');
assert.deepEqual(skipped.plan.grammarKeys, [], 'expected no grammar keys after parse error skip');
assert.ok(
  logLines.some((line) => /parse-error/i.test(String(line))),
  'expected parse-error skip log line'
);

console.log('tree-sitter scheduler plan skip-on-parse-error contract ok');
