#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createSearchLifecycle } from '../../helpers/search-lifecycle.js';
import {
  SHARED_SEARCH_CONTRACT_CASES
} from '../../helpers/search-contract-cases.js';

const createCodeFixture = async () => {
  const lifecycle = await createSearchLifecycle({
    cacheScope: 'isolated',
    cacheName: 'search-code-contract-matrix',
    embeddings: '0',
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off'
    }
  });
  const { repoRoot, buildIndex } = lifecycle;

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

  buildIndex({
    label: 'build search code contract matrix',
    mode: 'code',
    stage: 'stage1'
  });

  return lifecycle;
};

const runPayloadContractCase = async (fixture) => {
  const { runSearchPayload } = fixture;

  for (const entry of SHARED_SEARCH_CONTRACT_CASES) {
    const payload = runSearchPayload(entry.query, {
      label: `search code contract matrix ${entry.id}`,
      mode: entry.mode,
      topN: entry.top,
      backend: 'memory',
      annEnabled: false
    });
    entry.assertPayload(payload, { source: 'cli' });
  }
};

const runWindowsPathCase = async (fixture) => {
  const { runSearchPayload } = fixture;
  const runSearch = (extraArgs) => runSearchPayload('windows path filter', {
    label: 'search code contract matrix windows path',
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
    'search code contract matrix explain-symbol',
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

const fixture = await createCodeFixture();
await runPayloadContractCase(fixture);
await runWindowsPathCase(fixture);
await runExplainSymbolCase(fixture);

console.log('CLI search code contract matrix test passed');
