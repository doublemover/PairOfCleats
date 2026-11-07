#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';
const cases = ['topn-memory', 'topn-sqlite-fts', 'tie-memory', 'tie-sqlite'];
assert.deepEqual(JSON.parse(await fsPromises.readFile(new URL('./contract-matrix.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('cli/search/contract-matrix/')[1];
assert.ok(cases.includes(selected), 'run one independently bounded search contract case');

const createContractFixture = async () => {
  const lifecycle = await createSearchLifecycle({
    cacheScope: 'isolated',
    cacheName: 'search-contract-matrix',
    embeddings: '0',
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off'
    }
  });
  const { repoRoot, buildIndex, env } = lifecycle;

  const allowedFiles = ['allowed-1.txt', 'allowed-2.txt'];
  const blockedContent = `${Array.from({ length: 200 }, () => 'alpha').join(' ')}\n`;
  for (const file of allowedFiles) {
    await fsPromises.writeFile(path.join(repoRoot, file), 'alpha beta gamma\nalpha beta\n');
  }
  for (let i = 0; i < 12; i += 1) {
    await fsPromises.writeFile(path.join(repoRoot, `blocked-${i + 1}.txt`), blockedContent);
  }

  const tieContent = '# Title\n\ntiealpha beta gamma\ntiealpha beta gamma\n';
  const tieFiles = ['alpha-1.md', 'alpha-2.md', 'alpha-3.md'];
  for (const file of tieFiles) {
    await fsPromises.writeFile(path.join(repoRoot, file), tieContent);
  }

  buildIndex({
    label: 'build search contract matrix (prose)',
    mode: 'prose',
    stage: 'stage1'
  });
  await runSqliteBuild(repoRoot, { mode: 'prose', env });

  return {
    ...lifecycle,
    allowedFiles
  };
};

const runTopNFilterCase = async (fixture, backend) => {
  const { allowedFiles, runSearchPayload } = fixture;

  const payload = runSearchPayload('alpha', {
    label: `search contract matrix topN (${backend})`,
    mode: 'prose',
    topN: 2,
    backend,
    annEnabled: false,
    extraArgs: ['--file', 'allowed']
  });
  const hits = payload.prose || [];
  if (hits.length !== 2) throw new Error(`expected 2 ${backend} results, got ${hits.length}`);
  for (const hit of hits) {
    const fileBase = path.basename(hit.file || '');
    if (!fileBase.startsWith('allowed-')) throw new Error(`unexpected file in ${backend} results: ${fileBase}`);
  }
};

const runTieOrderCase = async (fixture, backend) => {
  const { runSearchPayload } = fixture;
  const runTieSearch = (backend) => {
    const payload = runSearchPayload('tiealpha', {
      label: `search contract matrix tie-order (${backend})`,
      mode: 'prose',
      topN: 3,
      backend,
      annEnabled: false
    });
    const hits = payload.prose || [];
    if (hits.length < 3) {
      throw new Error(`expected at least 3 prose hits for backend=${backend}`);
    }
    return hits.slice(0, 3);
  };

  const assertTie = (hits) => {
    const scores = hits.map((hit) => hit.score).filter((score) => Number.isFinite(score));
    if (scores.length !== hits.length) throw new Error('expected scores for tie-order hits');
    const baseline = Number(scores[0].toFixed(6));
    for (const score of scores) {
      if (Number(score.toFixed(6)) !== baseline) {
        throw new Error('expected tied scores across top hits');
      }
    }
  };

  const first = runTieSearch(backend);
  const second = runTieSearch(backend);
  assertTie(first);
  if (JSON.stringify(first.map((hit) => hit.file)) !== JSON.stringify(second.map((hit) => hit.file))) {
    throw new Error(`expected stable ordering under ties for ${backend} backend`);
  }
};

const fixture = await createContractFixture();
let primary;
let failed = false;
try {
  if (selected.startsWith('topn-')) await runTopNFilterCase(fixture, selected.slice(5));
  else await runTieOrderCase(fixture, selected.slice(4));
} catch (error) {
  failed = true; primary = error;
} finally {
  try {
    const owned = path.resolve(fixture.workspaceRoot);
    assert.equal(path.relative(path.resolve(os.tmpdir()), path.dirname(owned)), '');
    assert.ok(path.basename(owned).startsWith('pairofcleats-search-'));
    await fsPromises.rm(owned, { recursive: true, force: true });
  } catch (cleanup) {
    if (failed) throw new AggregateError([primary, cleanup], 'Search contract and owned fixture cleanup failed.');
    throw cleanup;
  }
}
if (failed) throw primary;
console.log(`CLI search contract ${selected} passed`);
