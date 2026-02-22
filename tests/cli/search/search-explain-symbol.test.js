#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';

const { repoRoot, buildIndex, runSearch } = await createSearchLifecycle({
  tempPrefix: 'pairofcleats-explain-symbol-',
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

await fsPromises.writeFile(
  path.join(repoRoot, 'symbol.js'),
  'export function boostExample() { return "symbol boost test"; }\n'
);

buildIndex({
  label: 'build_index',
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
  'search explain symbol',
  {
    stdio: 'pipe',
    encoding: 'utf8',
    onFailure: (failed) => {
      if (failed.stderr) console.error(failed.stderr.trim());
    }
  }
);

const output = getCombinedOutput(searchResult);
if (!output.includes('Symbol')) {
  console.error('Expected explain output to include symbol boost details.');
  process.exit(1);
}

console.log('explain symbol test passed');

