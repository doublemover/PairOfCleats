#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const writeRepo = async (repoRoot, cacheRoot, modes = ['code']) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
  const repoCacheRoot = getRepoCacheRoot(repoRoot);
  const buildRoot = path.join(repoCacheRoot, 'builds', 'test-build');
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
    buildId: 'test-build',
    buildRoot,
    modes
  }, null, 2), 'utf8');
  for (const mode of modes) {
    const indexDir = path.join(buildRoot, `index-${mode}`);
    await fs.mkdir(indexDir, { recursive: true });
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
    await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
    await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
      compatibilityKey: `compat-${mode}`
    }, null, 2), 'utf8');
  }
};

const withTempRoot = async (prefix, run) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run({
      tempRoot,
      cacheRoot: path.join(tempRoot, 'cache')
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};

const cases = [
  {
    name: 'diagnostic messages redact embedded absolute paths while preserving context',
    async run() {
      await withTempRoot('poc-fed-redact-diagnostic-', async ({ tempRoot, cacheRoot }) => {
        const repoA = path.join(tempRoot, 'repo-a');
        const repoB = path.join(tempRoot, 'repo-b');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo(repoA, cacheRoot);
        await writeRepo(repoB, cacheRoot);
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "a", "priority": 10 },
    { "root": "./repo-b", "alias": "b", "priority": 5 }
  ]
}`, 'utf8');

        const leakedPath = path.join(repoB, 'index-code', 'pieces', 'manifest.json');
        const response = await runFederatedSearch({
          workspacePath,
          query: 'diagnostic-redaction',
          search: { mode: 'code', top: 5 }
        }, {
          searchFn: async (repoRootCanonical) => {
            if (path.basename(repoRootCanonical) === 'repo-b') {
              throw createError(ERROR_CODES.NO_INDEX, `Missing pieces manifest: ${leakedPath}`);
            }
            return {
              backend: 'memory',
              code: [{ id: 'hit-a', file: 'src/a.js', start: 1, end: 1, score: 1 }],
              prose: [],
              extractedProse: [],
              records: []
            };
          }
        });

        assert.equal(response.ok, true);
        assert.equal(response.code.length, 1);
        const missingRepo = (response.repos || []).find((entry) => entry.repoId && entry.status === 'missing_index');
        assert.ok(missingRepo);
        const message = String(missingRepo?.error?.message || '');
        assert.ok(message.includes('Missing pieces manifest:'));
        assert.ok(message.includes('<redacted>'));
        assert.equal(message.includes(leakedPath), false);
      });
    }
  },
  {
    name: 'field-level redaction preserves non-path snippets and stays cached',
    async run() {
      await withTempRoot('poc-fed-redact-fields-', async ({ tempRoot, cacheRoot }) => {
        const repoRoot = path.join(tempRoot, 'repo');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo(repoRoot, cacheRoot);
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "sample" }
  ]
}`, 'utf8');

        const literalSnippet = 'C:\\snippet\\literal text should survive redaction';
        const absoluteFilePath = path.join(repoRoot, 'src', 'app.js');
        let searchCalls = 0;
        const request = {
          workspacePath,
          query: 'redaction-scope',
          select: [repoRoot],
          search: { mode: 'code', top: 5 }
        };

        const searchFn = async () => {
          searchCalls += 1;
          return {
            backend: 'memory',
            code: [
              {
                id: 'hit-1',
                file: absoluteFilePath,
                snippet: literalSnippet,
                start: 1,
                end: 1,
                score: 1
              }
            ],
            prose: [],
            extractedProse: [],
            records: []
          };
        };

        const first = await runFederatedSearch(request, { searchFn });
        const second = await runFederatedSearch(request, { searchFn });

        assert.equal(searchCalls, 1);
        assert.equal(first.code[0]?.file, '<redacted>');
        assert.equal(first.code[0]?.snippet, literalSnippet);
        assert.equal(first.meta?.selection?.explicitSelects?.[0], '<redacted>');
        assert.equal(first.meta?.cohorts?.selectedReposByMode?.code?.[0]?.rootAbs, '<redacted>');
        assert.equal(first.meta?.cohorts?.selectedReposByMode?.code?.[0]?.repoRootResolved, '<redacted>');
        assert.equal(first.meta?.cohorts?.selectedReposByMode?.code?.[0]?.indexes?.code?.indexDir, '<redacted>');
        assert.equal(second.code[0]?.file, '<redacted>');
        assert.equal(second.code[0]?.snippet, literalSnippet);
        assert.equal(second.meta?.selection?.explicitSelects?.[0], '<redacted>');
        assert.equal(second.meta?.cohorts?.selectedReposByMode?.code?.[0]?.rootAbs, '<redacted>');
        assert.equal(second.meta?.cohorts?.selectedReposByMode?.code?.[0]?.repoRootResolved, '<redacted>');
        assert.equal(second.meta?.cohorts?.selectedReposByMode?.code?.[0]?.indexes?.code?.indexDir, '<redacted>');
      });
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('federation path redaction contract matrix test passed');
