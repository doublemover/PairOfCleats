#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { setupSqliteBuildFixture, SQLITE_BUILD_FIXTURE_DEFAULT_TOKENS } from './helpers/build-fixture.js';

const root = process.cwd();
const env = applyTestEnv({ syncProcess: false });
const fixture = await setupSqliteBuildFixture({
  tempLabel: 'sqlite-build-bench-contract',
  chunkCount: 50,
  fileCount: 3,
  mode: 'code',
  // This benchmark independently checks every chunk token against persisted
  // postings. Publish both tokens, rather than the helper's one-token subset.
  tokenVocab: [...SQLITE_BUILD_FIXTURE_DEFAULT_TOKENS]
});

const benchScript = path.join(root, 'tools', 'bench', 'sqlite', 'build-from-artifacts.js');
const result = runNode(
  [
    benchScript,
    '--mode',
    'current',
    '--index-dir',
    fixture.indexDir,
    '--statement-strategy',
    'prepared'
  ],
  'sqlite build bench contract',
  root,
  env,
  { stdio: 'pipe', allowFailure: true }
);

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

