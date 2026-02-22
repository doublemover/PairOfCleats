#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { rmDirRecursive } from '../../helpers/temp.js';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';

const tempRoot = path.join(process.cwd(), '.testCache', 'windows-path-filter');
await rmDirRecursive(tempRoot, { retries: 10, delayMs: 100 });

const { repoRoot, buildIndex, runSearchPayload } = await createSearchLifecycle({
  tempRoot,
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
  label: 'build_index',
  mode: 'code'
});

function runSearch(extraArgs) {
  return runSearchPayload('windows path filter', {
    label: 'search windows path filter',
    mode: 'code',
    annEnabled: false,
    extraArgs
  });
}

const filePayload = runSearch(['--file', 'src\\nested\\util.js']);
if (!Array.isArray(filePayload.code) || filePayload.code.length === 0) {
  console.error('Expected results for Windows-style --file filter.');
  process.exit(1);
}

const pathPayload = runSearch(['--path', 'src\\nested']);
if (!Array.isArray(pathPayload.code) || pathPayload.code.length === 0) {
  console.error('Expected results for Windows-style --path filter.');
  process.exit(1);
}

console.log('windows path filter test passed');
