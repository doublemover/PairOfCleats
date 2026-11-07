import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const { dir } = await prepareIsolatedTestCacheDir('ci-build-sqlite-ownership');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo); await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{}');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), testConfig: { sqlite: { use: false } },
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const state = { calls: [], exports: [] }; globalThis.__ciSqliteOwner = state;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes('/tools/ci/build-artifacts.js')) {
    if (specifier === '../shared/cli-utils.js') return { url: 'ci-sqlite:commands', shortCircuit: true };
    if (specifier === './artifact-bundle.js') return { url: 'ci-sqlite:bundle', shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'ci-sqlite:commands') return { format: 'module', shortCircuit: true,
    source: 'export const runSubprocessOrExit=options=>globalThis.__ciSqliteOwner.calls.push(options);' };
  if (url === 'ci-sqlite:bundle') return { format: 'module', shortCircuit: true,
    source: 'export const exportCiArtifactBundle=async options=>globalThis.__ciSqliteOwner.exports.push(options);' };
  return next(url, context);
} });
const argv = process.argv;
try {
  for (const skipBuild of [false, true]) for (const skipSqlite of [false, true]) {
    state.calls.length = 0; state.exports.length = 0;
    process.argv = [argv[0], 'ci-build', '--repo', repo, '--quiet', '--progress', 'off',
      ...(skipBuild ? ['--skip-build'] : []), ...(skipSqlite ? ['--skip-sqlite'] : [])];
    await import(new URL(`../../../tools/ci/build-artifacts.js?build=${skipBuild}&sqlite=${skipSqlite}`, import.meta.url));
    assert.equal(state.calls.length, skipBuild && skipSqlite ? 0 : 1);
    if (state.calls.length) {
      const args = state.calls[0].args; assert.equal(args[args.indexOf('--repo') + 1], toRealPathSync(repo));
      assert.equal(args.includes('--stage'), skipBuild);
      if (!skipBuild) assert.ok(args.includes(skipSqlite ? '--no-sqlite' : '--sqlite'));
    }
    assert.equal(state.exports.length, 1); assert.equal(state.exports[0].includeSqlite, !skipSqlite);
  }
} finally { process.argv = argv; hook.deregister(); delete globalThis.__ciSqliteOwner; }
console.log('Actual CI wrapper routes normal/skip-build and explicit SQLite requests through one owner.');
