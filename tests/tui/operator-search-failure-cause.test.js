import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiSearchSession } from '../../tools/tui/operator/search.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('operator-search-failure-cause');
const repo = path.join(dir, 'repository'); await fs.mkdir(repo);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: false });
let released = false;
const original = Object.freeze(Object.assign(Error('PRIVATE_SECRET_TOKEN'), {
  code: 'SUBPROCESS_FAILED', result: { stdout: JSON.stringify({ ok: false, code: 'NO_INDEX', message: 'PRIVATE_SECRET_TOKEN' }) },
  cacheOwnershipPending: true, cacheOwnershipReleased: () => released
}));
const session = createTuiSearchSession({ toolRoot: process.cwd(), env, spawn: async () => { throw original; } });
const request = { repoPath: repo, search: { query: 'private-query', backend: 'memory' } };
let projected;
try { await session.query(request); assert.fail('child failure must reject'); } catch (error) { projected = error; }
assert.equal(projected.code, 'NO_INDEX');
assert.equal(projected.cause, original);
assert.equal(projected.cacheOwnershipReleased(), false);
assert.equal(session.status({}).resourcePending, true);
await assert.rejects(session.dispose(), error => error === projected);
released = true;
assert.equal(session.status({}).resourcePending, false);
assert.equal(projected.cacheOwnershipReleased(), true);
await session.dispose();
assert.equal(session.status({}).closed, true);
assert.throws(() => session.status({ repoPath: repo }), { code: 'ERR_TUI_SEARCH_REQUEST' });
console.log('Search child machine causes preserve original resource ownership through safe projection and disposal');
