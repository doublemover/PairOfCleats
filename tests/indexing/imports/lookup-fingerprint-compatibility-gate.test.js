#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-import-lookup-gate-'));
const srcDir = path.join(tempRoot, 'src');
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(path.join(srcDir, 'a.js'), 'import "./b.js";\n');
await fs.writeFile(path.join(srcDir, 'b.js'), 'export const b = 1;\n');

const entries = [
  { abs: path.join(srcDir, 'a.js'), rel: 'src/a.js' },
  { abs: path.join(srcDir, 'b.js'), rel: 'src/b.js' }
];
const importsByFile = {
  'src/a.js': ['./b.js']
};
const makeRelations = () => new Map([
  ['src/a.js', { imports: ['./b.js'] }]
]);

const cache = { files: {} };
resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: makeRelations(),
  enableGraph: false,
  cache
});
assert.equal(typeof cache.lookup?.compatibilityFingerprint, 'string', 'expected cached lookup fingerprint');

cache.lookup.compatibilityFingerprint = 'incompatible-fingerprint';

const gated = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: makeRelations(),
  enableGraph: false,
  cache
});

assert.equal(gated.cacheStats.lookupReused, false, 'lookup reuse must be blocked when fingerprint mismatches');
assert.equal(gated.cacheStats.lookupInvalidated, true, 'fingerprint mismatch should mark lookup invalidation');

console.log('lookup fingerprint compatibility gate test passed');
