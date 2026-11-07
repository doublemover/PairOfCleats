import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadTypeScript, loadTypeScriptModule, clearTypeScriptModuleCache } from '../../src/index/tooling/typescript/load.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { errorGraphIncludes } from '../helpers/error-graph.js';
import { rmDirRecursive } from '../helpers/temp.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/typescript-loader-original-failure/')[1];
assert.ok(['async-selected-failure', 'async-pending-original', 'sync-selected-failure', 'sync-pending-original',
  'installed-layout-is-not-absence', 'original-falsy-failures', 'absence-trust-and-positive-control'].includes(mode));
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const scope = path.join(repositoryRoot, '.tmp', 'tests', 'typescript-loader-original');
assertNoSymlinkPath(repositoryRoot, scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), repo = path.join(temporary, 'repo'), cache = path.join(temporary, 'cache');
await fs.mkdir(repo);
const priorTrust = process.env.PAIROFCLEATS_TRUSTED_REPOS, key = 'poc-typescript-original-' + randomUUID();
const originalSymbol = Symbol.for(key);
const actualCompiler = createRequire(import.meta.url).resolve('typescript');
const config = { dir: cache, typescript: { resolveOrder: ['cache', 'global'] } };
const make = async (location, body = null, { native = false } = {}) => {
  const pkg = location === 'sync' ? path.join(repo, 'node_modules', 'typescript') : path.join(cache, 'node', 'node_modules', 'typescript');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'typescript', version: native ? '7.1.0-beta' : '6.0.0-fixture',
    ...(native ? { exports: { './async': './async.js' } } : { main: './lib/typescript.js' }) }));
  if (body !== null) { await fs.mkdir(path.join(pkg, 'lib')); await fs.writeFile(path.join(pkg, 'lib', 'typescript.js'), body); }
};
const caught = async operation => {
  let failed = false, error;
  try { await operation(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true, 'selected compiler failure cannot become an ambient compiler success or optional absence');
  return error;
};
try {
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]);
  if (mode === 'absence-trust-and-positive-control') {
    assert.equal(await loadTypeScript({ dir: cache, typescript: { resolveOrder: ['cache'] } }, repo), null);
    await make('sync', `module.exports = { ...require(${JSON.stringify(actualCompiler)}), fixtureMarker: 'original-compiler' };\n`);
    delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
    assert.equal(await loadTypeScript({ typescript: { resolveOrder: ['repo'] } }, repo), null);
    process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]);
    assert.equal((await loadTypeScript({ typescript: { resolveOrder: ['repo'] } }, repo)).fixtureMarker, 'original-compiler');
    assert.equal(loadTypeScriptModule(repo).fixtureMarker, 'original-compiler');
  } else if (mode === 'installed-layout-is-not-absence') {
    await make('async', null, { native: true });
    const failure = await caught(() => loadTypeScript(config, repo));
    assert.equal(failure.code, 'ERR_SEMANTIC_DEPENDENCY_UNSEALED'); assert.equal(failure.reason, 'typescript_compiler_entry_missing');
    await make('sync', null, { native: true });
    assert.equal((await caught(() => loadTypeScriptModule(repo))).code, 'ERR_PACKAGE_PATH_NOT_EXPORTED');
  } else if (mode === 'original-falsy-failures') {
    for (const [index, original] of [undefined, null, false, 0, ''].entries()) {
      const selected = path.join(temporary, 'falsey-' + index), pkg = path.join(selected, 'node', 'node_modules', 'typescript', 'lib');
      await fs.mkdir(pkg, { recursive: true }); await fs.writeFile(path.join(pkg, 'typescript.js'), `throw globalThis[Symbol.for(${JSON.stringify(key)})];\n`);
      globalThis[originalSymbol] = original;
      assert.ok(Object.is(await caught(() => loadTypeScript({ ...config, dir: selected }, repo)), original));
    }
  } else {
    const sync = mode.startsWith('sync'), pending = mode.includes('pending'); let ready = !pending, codeReads = 0;
    // Explicit module/observation controls exercise actual Node loading, not a
    // vendor compiler, native resource retirement or TypeScript 7 qualification.
    const original = Object.freeze(Object.defineProperties(new Error('selected original compiler rejected'), {
      cacheOwnershipPending: { value: pending }, cacheOwnershipReleased: { value: () => ready },
      code: { get() { codeReads++; ready = true; return 'MODULE_NOT_FOUND'; } }
    }));
    globalThis[originalSymbol] = original;
    await make(sync ? 'sync' : 'async', `throw globalThis[Symbol.for(${JSON.stringify(key)})];\n`);
    const failure = await caught(() => sync ? loadTypeScriptModule(repo) : loadTypeScript(config, repo));
    assert.equal(codeReads, 0, 'a module execution failure never needs absence classification');
    if (pending) {
      assert.equal(errorGraphIncludes(failure, original), true); const observation = observeStorageResource(failure);
      assert.equal(observation.isSettled(), false); assert.throws(() => observation.requireSettled());
      ready = true; observation.requireSettled(); assert.equal(observation.isSettled(), true);
    } else assert.equal(failure, original, 'ordinary settled selected failures keep their exact identity');
  }
} finally {
  delete globalThis[originalSymbol]; clearTypeScriptModuleCache(repo);
  if (priorTrust === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS; else process.env.PAIROFCLEATS_TRUSTED_REPOS = priorTrust;
  assertNoSymlinkPath(repositoryRoot, temporary);
  const actual = await fs.realpath(temporary), parent = await fs.realpath(scope); assert.equal(path.dirname(actual), parent);
  await rmDirRecursive(actual, { retries: 0 });
}
console.log('TypeScript selected compiler failures retain original identity and observations without ambient substitution.');
