import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { sha1 } from '../../../src/shared/hash.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { createFileLookup } from '../../../src/index/build/import-resolution/lookup.js';
import { createTsConfigLoader, loadTsConfigCompilerOptions, resolveTsPaths, TS_PATH_MAPPING_VERSION }
  from '../../../src/index/build/import-resolution/tsconfig-resolution.js';

// Authored only. The installed compiler API is an independent resolution
// control when this fixture is explicitly run after the deferred validation gate.
applyTestEnv();
const root = await createImportResolutionTempRoot('typescript-path-pattern-ties');
const files = ['main.ts', 'tsconfig.json', 'fallback/item/suffix.ts', 'specific/item.ts',
  'exact/thing.ts', 'fallback/thing.ts', 'fallback/deep/thing.ts', 'long/thing.ts', 'fallback/index.ts'];
try {
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), 'export {};');
  }
  const lookup = createFileLookup({ root, entries: files.map(rel => ({ rel, abs: path.join(root, rel) })), caseSensitive: true });
  const resolve = async (paths, spec, expected) => {
    const configPath = path.join(root, 'tsconfig.json');
    await fs.writeFile(configPath, JSON.stringify({ compilerOptions: { baseUrl: '.', paths } }));
    const config = createTsConfigLoader({ rootAbs: root }).resolveForFile(path.join(root, 'main.ts'));
    assert.ok(config, 'the compiler admits the configured mapping profile');
    const actual = resolveTsPaths({ spec, tsconfig: config, lookup });
    const controlled = ts.resolveModuleName(spec, path.join(root, 'main.ts'), config.compilerOptions, ts.sys).resolvedModule;
    const compilerPath = controlled ? path.relative(root, controlled.resolvedFileName).replace(/\\/g, '/') : null;
    assert.equal(compilerPath, expected, 'the compiler control retains the declared expected target');
    assert.equal(actual?.resolved || null, expected, 'local path mapping agrees with the independent compiler control');
    assert.equal(config.pathMappingVersion, TS_PATH_MAPPING_VERSION);
    const loaded = loadTsConfigCompilerOptions(configPath);
    const legacyFingerprint = sha1(JSON.stringify({ baseUrlAbs: config.baseUrlAbs, paths: config.paths, dependencies: loaded.dependencies }));
    assert.notEqual(config.fingerprint, legacyFingerprint, 'existing per-importer cache admission must reject the previous mapping algorithm');
    return actual;
  };
  const first = await resolve({ '@tie/*': ['fallback/*'], '@tie/*/suffix': ['specific/*'] },
    '@tie/item/suffix', 'fallback/item/suffix.ts');
  assert.equal(first.pattern, '@tie/*', 'a longer suffix cannot override an equally long earlier prefix');
  const reversed = await resolve({ '@tie/*/suffix': ['specific/*'], '@tie/*': ['fallback/*'] },
    '@tie/item/suffix', 'specific/item.ts');
  assert.equal(reversed.pattern, '@tie/*/suffix', 'equal prefix ties preserve the reversed declaration order too');
  await resolve({ '@exact/*': ['fallback/*'], '@exact/thing': ['exact/thing.ts'] }, '@exact/thing', 'exact/thing.ts');
  await resolve({ '@long/*': ['fallback/*'], '@long/deep/*': ['long/*'] }, '@long/deep/thing', 'long/thing.ts');
  await resolve({ '@fall/*': ['missing/*', 'fallback/*'] }, '@fall/thing', 'fallback/thing.ts');
  await resolve({ '@miss/*': ['missing/*'], '@miss/*/suffix': ['specific/*'] }, '@miss/item/suffix', null);
  await resolve({ '@empty/*': ['fallback/*'] }, '@empty/', null);
  await resolve({ '@fixed': ['fallback/*'] }, '@fixed', null);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('TypeScript path prefix ties, nonempty star substitution and cache identity controls passed');
