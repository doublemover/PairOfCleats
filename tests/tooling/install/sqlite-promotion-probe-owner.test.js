import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rebuildSqliteNativeFromSource } from '../../../tools/setup/rebuild-native-sqlite.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/sqlite-promotion-probe-owner/')[1];
assert.ok(['original-probe-rejection-and-rollback', 'pending-probe-defers-rollback'].includes(mode));
const root = await makeTempDir('sqlite-promotion-probe-owner-');
const packageRoot = path.join(root, 'node_modules', 'better-sqlite3');
const prebuild = path.join(packageRoot, 'prebuild.node'), compiled = path.join(packageRoot, 'build', 'Release', 'better_sqlite3.node');
const completed = { exitCode: 0, signal: null, stdout: '', stderr: '' };
try {
  await fs.mkdir(path.dirname(compiled), { recursive: true }); await fs.mkdir(path.join(packageRoot, 'lib'));
  await fs.writeFile(path.join(packageRoot, 'package.json'), '{"type":"commonjs"}');
  await fs.writeFile(path.join(packageRoot, 'lib', 'binding.js'), 'exports.getPrebuildPath=()=>'+JSON.stringify(prebuild)+';');
  await fs.writeFile(compiled, 'independently checked fixture build');
  if (mode === 'original-probe-rejection-and-rollback') {
    for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('actual default probe/evidence failure'))]) {
      await fs.writeFile(prebuild, 'original working generation'); let calls = 0, caught = false;
      try {
        await rebuildSqliteNativeFromSource(root, async () => ({ ok: true }), { run: async () => {
          if (++calls === 1) return completed;
          assert.equal(await fs.readFile(prebuild, 'utf8'), 'independently checked fixture build'); throw original;
        } });
      } catch (error) { caught = true; assert.equal(error, original); }
      assert.equal(caught, true); assert.equal(calls, 2);
      assert.equal(await fs.readFile(prebuild, 'utf8'), 'original working generation');
    }
  } else {
    await fs.writeFile(prebuild, 'original working generation'); let retired = false, calls = 0;
    const pending = Object.assign(new Error('default loader still owns original work'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => retired
    });
    await assert.rejects(rebuildSqliteNativeFromSource(root, async () => ({ ok: true }), { run: async () => {
      if (++calls === 1) return completed; throw pending;
    } }), error => errorGraphIncludes(error, pending) && error.cacheOwnershipReleased() === false);
    assert.equal(calls, 2);
    assert.equal(await fs.readFile(prebuild, 'utf8'), 'independently checked fixture build', 'pending native work cannot authorize a competing rollback write');
    retired = true; // Retire only the fixture observation; no production retry.
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('SQLite promotion preserves exact callback failures and only rolls back after original probe retirement');
