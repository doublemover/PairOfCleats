#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { setupSqliteBuildFixture } from './helpers/build-fixture.js';

const root = process.cwd();
const fixture = await setupSqliteBuildFixture({
  tempLabel: 'sqlite-build-bench-contract',
  chunkCount: 50,
  fileCount: 3,
  mode: 'code'
});

const benchScript = path.join(root, 'tools', 'bench', 'sqlite', 'build-from-artifacts.js');
const result = spawnSync(process.execPath, [
  benchScript,
  '--mode',
  'current',
  '--index-dir',
  fixture.indexDir,
  '--statement-strategy',
  'prepared'
], { cwd: root, env: process.env, encoding: 'utf8' });

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(result.status ?? 1);
}

const output = `${result.stdout || ''}${result.stderr || ''}`;
assert.match(output, /\[bench\] build-from-artifacts current chunks=/, 'expected bench to report run');
assert.match(output, /\[bench\] current statementStrategy=/, 'expected bench to print strategy line');
assert.match(output, /\[bench\] current tables/, 'expected bench to print per-table stats');

console.log('sqlite build bench contract test passed');

