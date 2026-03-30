#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';
import {
  SHARED_SEARCH_CONTRACT_CASES
} from '../../helpers/search-contract-cases.js';

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

  await fsPromises.mkdir(path.join(repoRoot, 'src', 'nested'), { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'answer.js'),
    [
      'export function answer(value = 42) {',
      '  return value;',
      '}',
      '',
      'export function returnValue() {',
      '  return answer();',
      '}',
      ''
    ].join('\n')
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'nested', 'util.js'),
    'export function winPathFilter() { return "windows path filter"; }\n'
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'symbol.js'),
    'export function boostExample() { return "symbol boost test"; }\n'
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'README.md'),
    '# Sample\n\nalpha bravo\nreturn value documentation\n',
    'utf8'
  );

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
    label: 'build search contract matrix (code)',
    mode: 'code',
    stage: 'stage1'
  });
  buildIndex({
    label: 'build search contract matrix (prose)',
    mode: 'prose',
    stage: 'stage1'
  });
  await runSqliteBuild(repoRoot, { mode: 'code', env });
  await runSqliteBuild(repoRoot, { mode: 'prose', env });

  return {
    ...lifecycle,
    allowedFiles
  };
};

const runPayloadContractCase = async (fixture) => {
  const { runSearchPayload } = fixture;

  for (const entry of SHARED_SEARCH_CONTRACT_CASES) {
    const payload = runSearchPayload(entry.query, {
      label: `search contract matrix ${entry.id}`,
      mode: entry.mode,
      topN: entry.top,
      backend: 'memory',
      annEnabled: false
    });
    entry.assertPayload(payload, { source: 'cli' });
  }
};

const runTopNFilterCase = async (fixture) => {
  const { allowedFiles, runSearchPayload } = fixture;

  for (const backend of ['memory', 'sqlite-fts']) {
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
  }
};

const runWindowsPathCase = async (fixture) => {
  const { runSearchPayload } = fixture;
  const runSearch = (extraArgs) => runSearchPayload('windows path filter', {
    label: 'search contract matrix windows path',
    mode: 'code',
    annEnabled: false,
    extraArgs
  });

  const filePayload = runSearch(['--file', 'src\\nested\\util.js']);
  if (!Array.isArray(filePayload.code) || filePayload.code.length === 0) {
    throw new Error('expected results for Windows-style --file filter');
  }

  const pathPayload = runSearch(['--path', 'src\\nested']);
  if (!Array.isArray(pathPayload.code) || pathPayload.code.length === 0) {
    throw new Error('expected results for Windows-style --path filter');
  }
};

const runExplainSymbolCase = async (fixture) => {
  const { repoRoot, runSearch } = fixture;
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
    'search contract matrix explain-symbol',
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

const runTieOrderCase = async (fixture) => {
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

const fixture = await createContractFixture();
await runPayloadContractCase(fixture);
await runTopNFilterCase(fixture);
await runWindowsPathCase(fixture);
await runExplainSymbolCase(fixture);
await runTieOrderCase(fixture);

console.log('CLI search contract matrix test passed');
