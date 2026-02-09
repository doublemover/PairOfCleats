#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runTreeSitterScheduler } from '../../../src/index/build/tree-sitter-scheduler/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'tree-sitter-scheduler-swift', 'index-code');
const swiftAbs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'swift.swift');

const log = () => {};

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

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

const scheduler = await runTreeSitterScheduler({
  mode: 'code',
  runtime,
  entries: [swiftAbs],
  outDir,
  abortSignal: null,
  log
});

assert.ok(scheduler, 'expected scheduler lookup');
assert.ok(scheduler.index instanceof Map, 'expected scheduler index map');
assert.equal(scheduler.index.size, 1, 'expected a single virtual doc entry');

const [virtualPath] = Array.from(scheduler.index.keys());
const containerPrefix = '.poc-vfs/tests/fixtures/tree-sitter/swift.swift';
assert.ok(
  typeof virtualPath === 'string'
    && (virtualPath === containerPrefix || virtualPath.startsWith(`${containerPrefix}#seg:`)),
  `unexpected virtualPath: ${virtualPath}`
);

const chunks = await scheduler.loadChunks(virtualPath);
assert.ok(Array.isArray(chunks) && chunks.length > 0, 'expected tree-sitter chunks for swift virtual doc');

console.log('tree-sitter scheduler swift subprocess ok');
