#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { runSearchCli } from '../../../src/retrieval/cli.js';
import { createQueryPlanCache } from '../../../src/retrieval/query-plan-cache.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-filter-only-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
try {
  const indexDir = await createCompatibilityIndex(root, { compatibilityKey: 'filter-only-fixture', profileId: 'default' });
  const chunks = Array.from({ length: 17 }, (_, id) => ({ id, file: `src/${id}.ts`, start: 0, end: 1,
    kind: 'FunctionDeclaration', name: `fn${id}`, chunkUid: `uid:${id}`, tokens: ['alpha'],
    docmeta: { returns: id % 2 ? 'boolean' : 'number' }, codeRelations: { calls: [[`fn${id}`, id % 2 ? 'read' : 'write']] } }));
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunks));
  const queryPlanCache = createQueryPlanCache();
  const search = (args, mode = 'code') => runSearchCli(['--repo', root, '--mode', mode, '--backend', 'memory', '--json', '--compact', '--no-comments', ...args],
    { emitOutput: false, exitOnError: false, queryPlanCache });
  await assert.rejects(search([]), /usage:/);
  let cursor = null;
  const ids = [];
  do {
    const page = await search(['--return-type', 'boolean', '--top', '3', ...(cursor ? ['--cursor', cursor] : [])]);
    assert.equal(page.pagination.total, 8);
    assert.ok(page.code.every((hit) => hit.scoreType === 'filter'));
    ids.push(...page.code.map((hit) => hit.id));
    cursor = page.pagination.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, [1, 3, 5, 7, 9, 11, 13, 15]);
  const impossible = await search(['--ext', 'ts', '--filter', 'ext:js']);
  assert.equal(impossible.pagination.total, 0, 'disjoint extension filters must remain impossible');
  const numbers = await search(['--return-type', 'number', '--top', '100']);
  assert.deepEqual(numbers.code.map((hit) => hit.id), [0, 2, 4, 6, 8, 10, 12, 14, 16]);
  const reads = await search(['--calls', 'read', '--top', '100']);
  const writes = await search(['--calls', 'write', '--top', '100']);
  assert.deepEqual(reads.code.map((hit) => hit.id), ids);
  assert.deepEqual(writes.code.map((hit) => hit.id), numbers.code.map((hit) => hit.id));
  await assert.rejects(search(['alpha', '--return-type', 'number', '--cursor', 'bad']), /filter-only/);
  const spawned = spawnSync(process.execPath, ['bin/pairofcleats.js', 'search', '--repo', root, '--mode', 'code',
    '--backend', 'memory', '--json', '--compact', '--no-comments', '--return-type', 'boolean', '--top', '2'],
  { encoding: 'utf8', timeout: 10000 });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const wrapped = JSON.parse(spawned.stdout);
  assert.equal(wrapped.pagination.total, 8);
  assert.equal(wrapped.code.length, 2);
  const proseDir = await createCompatibilityIndex(root, {
    mode: 'prose', compatibilityKey: 'filter-only-fixture', profileId: 'default'
  });
  await fs.writeFile(path.join(proseDir, 'chunk_meta.json'), '[]');
  await assert.rejects(search(['--return-type', 'boolean'], 'both'), /index-extracted-prose/,
    'a requested missing index must fail explicitly rather than silently omit a mode');
  const extractedDir = await createCompatibilityIndex(root, {
    mode: 'extracted-prose', compatibilityKey: 'filter-only-fixture', profileId: 'default'
  });
  await fs.writeFile(path.join(extractedDir, 'chunk_meta.json'), '[]');
  let mixedCursor = null;
  const mixedIds = [];
  do {
    const page = await search(['--return-type', 'boolean', '--top', '3',
      ...(mixedCursor ? ['--cursor', mixedCursor] : [])], 'both');
    assert.deepEqual(page.prose, []);
    assert.deepEqual(page.extractedProse, []);
    assert.deepEqual(page.pagination.byMode['extracted-prose'], { offset: 0, total: 0, returned: 0, hasMore: false });
    assert.deepEqual(page.pagination.byMode.prose, { offset: 0, total: 0, returned: 0, hasMore: false });
    mixedIds.push(...page.code.map(hit => hit.id));
    mixedCursor = page.pagination.nextCursor;
  } while (mixedCursor);
  assert.deepEqual(mixedIds, ids, 'persisted empty modes retain a valid cursor state');
  const statePath = path.join(indexDir, 'index_state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  await fs.writeFile(statePath, JSON.stringify({ ...state, buildId: 'changed' }));
  await assert.rejects(search(['--return-type', 'boolean', '--cursor', wrapped.pagination.nextCursor]), /generation changed/);
  console.log('filter-only CLI and warm semantic filter cache test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
