#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';

const runExplainSymbolCase = async () => {
  const { repoRoot, buildIndex, runSearch } = await createSearchLifecycle({
    cacheScope: 'shared',
    cacheName: 'search-explain-and-order-explain-symbol',
    embeddings: '0',
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off'
    }
  });

  await fsPromises.writeFile(
    path.join(repoRoot, 'symbol.js'),
    'export function boostExample() { return "symbol boost test"; }\n'
  );

  buildIndex({
    label: 'build_index for search explain/order matrix explain-symbol',
    mode: 'code'
  });

  const searchResult = runSearch(
    [
      'boostExample',
      '--mode',
      'code',
      '--explain',
      '--no-ann',
      '--repo',
      repoRoot
    ],
    'search explain/order matrix explain-symbol',
    {
      stdio: 'pipe',
      encoding: 'utf8',
      onFailure: (failed) => {
        if (failed.stderr) console.error(failed.stderr.trim());
      }
    }
  );

  const output = searchResult.stdout || searchResult.stderr || '';
  if (!output.includes('Symbol')) {
    throw new Error('expected explain output to include symbol boost details');
  }
};

const runTieOrderCase = async () => {
  const lifecycle = await createSearchLifecycle({
    cacheScope: 'shared',
    cacheName: 'search-explain-and-order-tie-order',
    embeddings: '0'
  });
  const { repoRoot, buildIndex, env, runSearchPayload } = lifecycle;

  const content = '# Title\n\nalpha beta gamma\nalpha beta gamma\n';
  const files = ['alpha-1.md', 'alpha-2.md', 'alpha-3.md'];
  for (const file of files) {
    await fsPromises.writeFile(path.join(repoRoot, file), content);
  }

  buildIndex({
    label: 'build index for search explain/order matrix tie-order',
    extraArgs: ['--sqlite']
  });
  await runSqliteBuild(repoRoot, { env });

  const runTieSearch = (backend) => {
    const payload = runSearchPayload('alpha', {
      label: `search explain/order matrix tie-order (${backend})`,
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

  const memoryFirst = runTieSearch('memory');
  const memorySecond = runTieSearch('memory');
  assertTie(memoryFirst);
  if (JSON.stringify(memoryFirst.map((hit) => hit.file)) !== JSON.stringify(memorySecond.map((hit) => hit.file))) {
    throw new Error('expected stable ordering under ties for memory backend');
  }

  const sqliteFirst = runTieSearch('sqlite');
  const sqliteSecond = runTieSearch('sqlite');
  assertTie(sqliteFirst);
  if (JSON.stringify(sqliteFirst.map((hit) => hit.file)) !== JSON.stringify(sqliteSecond.map((hit) => hit.file))) {
    throw new Error('expected stable ordering under ties for sqlite backend');
  }
};

await runExplainSymbolCase();
await runTieOrderCase();

console.log('search explain and order contract matrix test passed');
