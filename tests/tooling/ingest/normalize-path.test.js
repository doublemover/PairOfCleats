#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { normalizePathForPlatform } from '../../../src/shared/path-normalize.js';
import { normalizeRepoRelativePath } from '../../../tools/ingest/shared.js';

const repoRoot = path.join(process.cwd(), 'tests', 'fixtures', 'sample');
const nestedPath = path.join(repoRoot, 'src', 'sample.ts');
const outsidePath = path.join(process.cwd(), 'outside.ts');

assert.equal(normalizeRepoRelativePath(repoRoot, 'src/sample.ts'), 'src/sample.ts');
assert.equal(normalizeRepoRelativePath(repoRoot, './src/sample.ts'), 'src/sample.ts');
assert.equal(normalizeRepoRelativePath(repoRoot, nestedPath), 'src/sample.ts');
assert.equal(normalizeRepoRelativePath(repoRoot, '../outside.ts'), null);
assert.equal(normalizeRepoRelativePath(repoRoot, outsidePath), null);
assert.equal(normalizeRepoRelativePath(repoRoot, repoRoot), null);

assert.equal(
  normalizeRepoRelativePath(repoRoot, '/repo/src/sample.ts', { stripVirtualRepoRoot: true }),
  'src/sample.ts'
);
assert.equal(
  normalizeRepoRelativePath(repoRoot, '/repo/..config/settings.json', { stripVirtualRepoRoot: true }),
  '..config/settings.json'
);
assert.equal(
  normalizeRepoRelativePath(repoRoot, '/repo/../outside.ts', { stripVirtualRepoRoot: true }),
  null
);
assert.equal(
  normalizeRepoRelativePath(repoRoot, '/repo', { stripVirtualRepoRoot: true }),
  ''
);

const winRepoRoot = normalizePathForPlatform('C:/repo-root', { platform: 'win32' });
assert.equal(
  normalizeRepoRelativePath(winRepoRoot, '/C:/repo-root/src/sample.ts', { stripVirtualRepoRoot: true }),
  'src/sample.ts'
);

console.log('ingest path normalization test passed');
