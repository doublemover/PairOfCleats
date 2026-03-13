#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSqliteReport } from '../../../src/index/validate/sqlite-report.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-validate-sqlite-zero-state-db-required');
const repoRoot = path.join(tempRoot, 'repo');
const indexRoot = path.join(tempRoot, 'build-root');
const proseIndexDir = path.join(indexRoot, 'index-prose');
const prosePiecesDir = path.join(proseIndexDir, 'pieces');
const sqliteDir = path.join(indexRoot, 'index-sqlite');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(prosePiecesDir, { recursive: true });
await fs.mkdir(sqliteDir, { recursive: true });
await fs.writeFile(path.join(prosePiecesDir, 'sqlite-zero-state.json'), '{}\n', 'utf8');

const userConfig = {
  cache: { root: path.join(tempRoot, 'cache') },
  sqlite: { use: true, dbDir: sqliteDir },
  lmdb: { use: false }
};

const zeroStateValidation = { issues: [], hints: [] };
const zeroStateResult = await buildSqliteReport({
  root: repoRoot,
  userConfig,
  indexRoot,
  modes: ['prose'],
  report: zeroStateValidation,
  sqliteEnabled: true
});

assert.equal(zeroStateResult.ok, true, 'expected zero-state prose sqlite validation to pass without db');
assert.deepEqual(zeroStateResult.issues, [], 'expected no sqlite issues for zero-state prose mode');
assert.ok(
  zeroStateResult.zeroStateModes.includes('prose'),
  `expected prose in zeroStateModes, got: ${JSON.stringify(zeroStateResult.zeroStateModes)}`
);
assert.equal(
  zeroStateValidation.issues.some((issue) => issue.includes('[sqlite] prose db missing')),
  false,
  `expected no prose missing-db issue, got: ${zeroStateValidation.issues.join('; ')}`
);

const nonZeroValidation = { issues: [], hints: [] };
const nonZeroResult = await buildSqliteReport({
  root: repoRoot,
  userConfig,
  indexRoot,
  modes: ['code'],
  report: nonZeroValidation,
  sqliteEnabled: true
});

assert.equal(nonZeroResult.ok, false, 'expected non-zero code sqlite validation to fail when db is missing');
assert.ok(
  nonZeroResult.issues.includes('code db missing'),
  `expected code db missing issue, got: ${nonZeroResult.issues.join('; ')}`
);
assert.ok(
  nonZeroValidation.issues.some((issue) => issue.includes('[sqlite] code db missing')),
  `expected propagated code missing-db issue, got: ${nonZeroValidation.issues.join('; ')}`
);

console.log('index-validate sqlite zero-state db-required test passed');
