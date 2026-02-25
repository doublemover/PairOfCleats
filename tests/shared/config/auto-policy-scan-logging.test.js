#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildAutoPolicy } from '../../../src/shared/auto-policy.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'auto-policy-scan-logging');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'node_modules', 'pkg'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'benchmarks', 'repos', 'fixture'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'README.md'), '# fixture\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'index.js'), 'export const value = 1;\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'node_modules', 'pkg', 'ignored.js'), 'module.exports = 1;\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'benchmarks', 'repos', 'fixture', 'ignored.txt'), 'ignore me\n', 'utf8');
await fs.writeFile(path.join(tempRoot, '.gitignore'), 'benchmarks/\n', 'utf8');

const logs = [];
const policy = await buildAutoPolicy({
  repoRoot: tempRoot,
  config: { quality: 'max' },
  resources: { cpuCount: 16, memoryGb: 64 },
  scanLimits: { statConcurrency: 4 },
  logger: (line) => logs.push(String(line || ''))
});

assert.equal(policy.quality.value, 'max', 'expected explicit max quality to be preserved');
assert.equal(policy.repo.fileCount, 2, `expected ignored directories to be skipped, got ${policy.repo.fileCount}`);
assert.ok(
  logs.some((line) => line.includes('loaded ignore files') && line.includes('.gitignore')),
  `expected .gitignore load log, got: ${logs.join(' | ')}`
);
assert.ok(
  logs.some((line) => line.includes('auto policy scan: starting')),
  `expected scan start log, got: ${logs.join(' | ')}`
);
assert.ok(
  logs.some((line) => line.includes('auto policy scan: done in')),
  `expected scan completion log, got: ${logs.join(' | ')}`
);
assert.ok(
  logs.some((line) => line.includes('auto policy resolved:')),
  `expected policy summary log, got: ${logs.join(' | ')}`
);

console.log('auto policy scan logging test passed');
