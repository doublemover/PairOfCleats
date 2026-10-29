#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  resolveRelativeImportCandidate,
  resolveRelativeImportCandidates
} from '../../../src/index/shared/import-candidates.js';
import { resolveRelativeImport } from '../../../src/index/type-inference-crossfile/resolve-relative-import.js';
import { DEFAULT_IMPORT_EXTS } from '../../../src/index/build/import-resolution/constants.js';

applyTestEnv();

const extensions = ['.ts', '.js'];
assert.deepEqual(
  resolveRelativeImportCandidates('src/lib/util', extensions),
  ['src/lib/util', 'src/lib/util.ts', 'src/lib/util/index.ts', 'src/lib/util.js', 'src/lib/util/index.js']
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

// Explicit runtime extensions keep literal-file precedence, then try their
// bounded TypeScript source counterparts. They never turn into directories.
for (const [runtimeExt, sourceExts] of [
  ['.js', ['.ts', '.tsx', '.d.ts']],
  ['.jsx', ['.tsx', '.ts', '.d.ts']],
  ['.mjs', ['.mts', '.d.mts']],
  ['.cjs', ['.cts', '.d.cts']]
]) {
  const literal = `src/target${runtimeExt}`;
  assert.deepEqual(resolveRelativeImportCandidates(literal, DEFAULT_IMPORT_EXTS), [
    literal, ...sourceExts.map((ext) => `src/target${ext}`)
  ]);
  for (const sourceExt of sourceExts) {
    const source = `src/target${sourceExt}`;
    assert.equal(resolveRelativeImport('src/app.ts', `./target${runtimeExt}`, new Set([source])), source);
    assert.equal(resolveRelativeImport('src/app.ts', `./target${runtimeExt}`, new Set([source, literal])), literal);
  }
}
assert.deepEqual(resolveRelativeImportCandidates('src/target.js', ['.js']), ['src/target.js']);
assert.deepEqual(resolveRelativeImportCandidates('src/target.css', DEFAULT_IMPORT_EXTS), ['src/target.css']);
assert.equal(resolveRelativeImport('src/app.ts', './target.mjs', new Set(['src/target.ts'])), null);
assert.equal(resolveRelativeImport('src/app.ts', './target.js', new Set(['src/target/index.ts'])), null);
assert.equal(resolveRelativeImport('src\\app.ts', '.\\target.js', new Set(['src/target.ts'])), 'src/target.ts');

console.log('import candidates parity test passed');

assert.deepEqual(resolveRelativeImportCandidates('src/pkg.v2/', ['.js', '.ts']),
  ['src/pkg.v2/index.js', 'src/pkg.v2/index.ts']);
assert.equal(resolveRelativeImport('src/app.js', './pkg.v2/', new Set(['src/pkg.v2/index.js'])),
  'src/pkg.v2/index.js');
assert.equal(resolveRelativeImportCandidate('src/pkg.v2/', { extensions: ['.js'],
  resolve: candidate => candidate === 'src/pkg.v2/index.js' ? candidate : null }), 'src/pkg.v2/index.js');
assert.deepEqual(resolveRelativeImportCandidates('src/pkg.v2', ['.js']), ['src/pkg.v2'],
  'a dotted path without a directory hint keeps literal-file precedence');

const { dir: directoryRoot } = await prepareIsolatedTestCacheDir('dotted-directory-import');
try {
  const paths = ['src/app.js', 'src/pkg.v2/index.js'];
  for (const file of paths) {
    await fs.mkdir(path.dirname(path.join(directoryRoot, file)), { recursive: true });
    await fs.writeFile(path.join(directoryRoot, file), file.endsWith('app.js') ? 'import "./pkg.v2/";' : 'export const target = 1;');
  }
  const fileRelations = new Map([['src/app.js', { imports: ['./pkg.v2/'] }]]);
  const result = resolveImportLinks({ root: directoryRoot,
    entries: paths.map(rel => ({ rel, abs: path.join(directoryRoot, rel) })),
    importsByFile: { 'src/app.js': ['./pkg.v2/'] }, fileRelations, enableGraph: false });
  assert.deepEqual(fileRelations.get('src/app.js').importLinks, ['src/pkg.v2/index.js']);
  assert.equal(result.stats.unresolved, 0);
} finally { await fs.rm(directoryRoot, { recursive: true, force: true }); }
