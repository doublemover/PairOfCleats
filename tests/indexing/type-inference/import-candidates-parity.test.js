#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  resolveRelativeImportCandidate,
  resolveRelativeImportCandidates
} from '../../../src/index/shared/import-candidates.js';
import { resolveRelativeImport } from '../../../src/index/type-inference-crossfile/resolve-relative-import.js';

applyTestEnv();

const extensions = ['.ts', '.js'];
assert.deepEqual(
  resolveRelativeImportCandidates('src/lib/util', extensions),
  ['src/lib/util.ts', 'src/lib/util/index.ts', 'src/lib/util.js', 'src/lib/util/index.js']
);
assert.deepEqual(
  resolveRelativeImportCandidates('src/lib/util/', extensions),
  ['src/lib/util/index.ts', 'src/lib/util/index.js']
);
assert.deepEqual(
  resolveRelativeImportCandidates('src/lib/util.ts', extensions),
  ['src/lib/util.ts']
);

const candidate = resolveRelativeImportCandidate('src/lib/util', {
  extensions,
  resolve: (entry) => (entry.endsWith('index.js') ? entry : null)
});
assert.equal(candidate, 'src/lib/util/index.js');

const fileSet = new Set([
  'src/lib.js',
  'src/dupe.ts',
  'src/dupe/index.ts',
  'src/util/index.tsx',
  'src/helpers.mjs'
]);
assert.equal(resolveRelativeImport('src/app.js', './lib', fileSet), 'src/lib.js');
assert.equal(resolveRelativeImport('src/app.js', './util', fileSet), 'src/util/index.tsx');
assert.equal(resolveRelativeImport('src/app.js', './dupe/', fileSet), 'src/dupe/index.ts');

console.log('import candidates parity test passed');
