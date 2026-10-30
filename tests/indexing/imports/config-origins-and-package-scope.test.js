import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { createFileLookup, resolveFromLookup } from '../../../src/index/build/import-resolution/lookup.js';
import { createTsConfigLoader, resolveTsPaths } from '../../../src/index/build/import-resolution/tsconfig-resolution.js';
import { createPackageImportsResolver, fingerprintPackageDependency } from '../../../src/index/build/import-resolution/package-entry.js';
import { normalizeImportSpecifier } from '../../../src/index/build/import-resolution/path-utils.js';

applyTestEnv();
const root = await createImportResolutionTempRoot('config-origins-package-scope');
const write = async (rel, data) => {
  const absolute = path.join(root, rel);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, typeof data === 'string' ? data : JSON.stringify(data));
};
try {
  const files = ['configs/one.json', 'configs/two.json', 'app/tsconfig.json',
    'configs/source/value.ts', 'configs/fallback/value.ts', 'app/main.ts',
    'app/feature.ts', 'app/feature-two.ts', 'app/pkg.ts'];
  for (const file of files) await write(file, 'export {};');
  await write('configs/one.json', { compilerOptions: { baseUrl: '.', paths: {
    '@scope/*': ['source/*', 'fallback/*'], '@scope/absent/*': ['missing/*']
  } } });
  await write('configs/two.json', { compilerOptions: { strict: true } });
  await write('app/tsconfig.json', { extends: ['../configs/one.json', '../configs/two.json'] });
  const lookup = createFileLookup({ root, entries: files.map(rel => ({ rel, abs: path.join(root, rel) })), caseSensitive: true });
  const config = createTsConfigLoader({ rootAbs: root }).resolveForFile(path.join(root, 'app/main.ts'));
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.baseUrlAbs, path.join(root, 'configs').replace(/\\/g, '/'));
  assert.equal(resolveTsPaths({ spec: '@scope/value', tsconfig: config, lookup }).resolved,
    'configs/source/value.ts', 'replacement declaration order outranks alphabetical order');
  assert.equal(resolveTsPaths({ spec: '@scope/absent/value', tsconfig: config, lookup }), null,
    'a winning but missing key cannot fall through to a less specific pattern');
  assert.equal(resolveFromLookup('app/FEATURE.ts', lookup), null);
  assert.equal(normalizeImportSpecifier('#feature'), '#feature');
  await write('app/package.json', { imports: { '#feature': './feature.ts', '#external': 'pkg' } });
  const dependencies = new Map();
  const resolver = createPackageImportsResolver({ lookup, rootAbs: root,
    onDependency: (file, signature) => dependencies.set(file, signature) });
  assert.equal(resolver('#feature', 'app/main.ts'), 'app/feature.ts');
  assert.equal(resolver('#external', 'app/main.ts'), null,
    'an external package target is never fabricated as an adjacent source file');
  const packageFile = path.join(root, 'app/package.json');
  const before = fingerprintPackageDependency(packageFile);
  await write('app/package.json', { imports: { '#feature': './feature-two.ts' } });
  assert.notEqual(fingerprintPackageDependency(packageFile), before);
  assert.equal(resolver('#feature', 'app/main.ts'), 'app/feature-two.ts');
  assert.ok(dependencies.has(packageFile));
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('configuration origins and package scopes passed');
