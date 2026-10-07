#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { cleanup, createSmokeIndexFixture, root, runSmokeNode } from './smoke-utils.js';
import { runSqliteBuild } from '../helpers/sqlite-builder.js';

let tempRoot = null;

let failure = null;
try {
  const fixture = await createSmokeIndexFixture({
    name: 'smoke-sqlite',
    token: 'sqlite_smoke_token'
  });
  tempRoot = fixture.tempRoot;
  const { env, repoRoot } = fixture;
  const run = (label, args, options = {}) =>
    runSmokeNode(label, args, { cwd: repoRoot, env, options });

  run('build_index', [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ]);
  await runSqliteBuild(repoRoot, { mode: 'code', env });

  const searchResult = run('search sqlite backend', [
    path.join(root, 'search.js'),
    'sqlite_smoke_token',
    '--mode',
    'code',
    '--backend',
    'sqlite',
    '--json',
    '--repo',
    repoRoot
  ]);

  const payload = JSON.parse(searchResult.stdout || '{}');
  const hits = Array.isArray(payload?.code) ? payload.code : [];
  assert.ok(hits.length > 0, 'expected sqlite smoke search to return at least one code hit');
  assert.ok(
    hits.some((hit) => String(hit?.file || '').includes('src/alpha.js')),
    'expected sqlite smoke search to return src/alpha.js'
  );
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
if (tempRoot) {
  await cleanup([tempRoot]);
}

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke sqlite passed');

