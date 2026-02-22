#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { rmDirRecursive } from '../../helpers/temp.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';

const tempRoot = path.join(process.cwd(), '.testCache', 'search-topn-filters');

await rmDirRecursive(tempRoot, { retries: 10, delayMs: 100 });
const lifecycle = await createSearchLifecycle({ tempRoot });
const { repoRoot, runSearchPayload, buildIndex } = lifecycle;

const allowedFiles = ['allowed-1.txt', 'allowed-2.txt'];
const blockedCount = 12;
const allowedContent = 'alpha beta gamma\nalpha beta\n';
const blockedContent = `${Array.from({ length: 200 }, () => 'alpha').join(' ')}\n`;

for (const file of allowedFiles) {
  await fsPromises.writeFile(path.join(repoRoot, file), allowedContent);
}
for (let i = 0; i < blockedCount; i += 1) {
  await fsPromises.writeFile(path.join(repoRoot, `blocked-${i + 1}.txt`), blockedContent);
}

buildIndex();
await runSqliteBuild(repoRoot);

function runBackendSearch(backend) {
  const payload = runSearchPayload('alpha', {
    label: `search (${backend})`,
    mode: 'prose',
    topN: 2,
    backend,
    annEnabled: false,
    extraArgs: ['--file', 'allowed']
  });
  const hits = payload.prose || [];
  if (hits.length !== 2) {
    console.error(`Expected 2 results for ${backend}, got ${hits.length}`);
    process.exit(1);
  }
  for (const hit of hits) {
    const fileBase = path.basename(hit.file || '');
    if (!fileBase.startsWith('allowed-')) {
      console.error(`Unexpected file in ${backend} results: ${fileBase}`);
      process.exit(1);
    }
  }
}

runBackendSearch('memory');
runBackendSearch('sqlite-fts');

console.log('search top-N filter tests passed');

