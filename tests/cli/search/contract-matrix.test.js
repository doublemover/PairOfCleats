#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';
import {
  prepareSharedSearchContractFixture,
  SHARED_SEARCH_CONTRACT_CASES
} from '../../helpers/search-contract-cases.js';

const runPayloadContractCase = async () => {
  const { runSearchPayload } = await prepareSharedSearchContractFixture({
    cacheName: 'search-contract-matrix-shared'
  });

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

const runTopNFilterCase = async () => {
  const lifecycle = await createSearchLifecycle({
    cacheScope: 'shared',
    cacheName: 'search-contract-matrix-topn'
  });
  const { repoRoot, runSearchPayload, buildIndex, env } = lifecycle;

  const allowedFiles = ['allowed-1.txt', 'allowed-2.txt'];
  const blockedContent = `${Array.from({ length: 200 }, () => 'alpha').join(' ')}\n`;

  for (const file of allowedFiles) {
    await fsPromises.writeFile(path.join(repoRoot, file), 'alpha beta gamma\nalpha beta\n');
  }
  for (let i = 0; i < 12; i += 1) {
    await fsPromises.writeFile(path.join(repoRoot, `blocked-${i + 1}.txt`), blockedContent);
  }

  buildIndex();
  await runSqliteBuild(repoRoot, { env });

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

const runWindowsPathCase = async () => {
  const { repoRoot, buildIndex, runSearchPayload } = await createSearchLifecycle({
    cacheScope: 'shared',
    cacheName: 'search-contract-matrix-winpath',
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off'
    }
  });

  await fsPromises.mkdir(path.join(repoRoot, 'src', 'nested'), { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'nested', 'util.js'),
    'export function winPathFilter() { return "windows path filter"; }\n'
  );

  buildIndex({
    label: 'build_index for search contract matrix windows path',
    mode: 'code'
  });

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

await runPayloadContractCase();
await runTopNFilterCase();
await runWindowsPathCase();

console.log('CLI search contract matrix test passed');
