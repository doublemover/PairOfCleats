#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { runNode } from '../../helpers/run-node.js';
import { createInProcessFilterSearch, ensureSearchFiltersRepo } from '../../helpers/search-filters-repo.js';

const filterRepoContext = await ensureSearchFiltersRepo();
if (!filterRepoContext) process.exit(0);

const { repoRoot: filterRepoRoot, env: filterRepoEnv } = filterRepoContext;
const runFilterSearch = createInProcessFilterSearch({
  repoRoot: filterRepoRoot,
  env: filterRepoEnv
});
const extractFiles = (payload, key = 'prose') => new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const cases = [
  {
    name: 'negative token and phrase syntax filters prose hits',
    async run() {
      const negativeToken = await runFilterSearch({ query: 'alpha -gamma' });
      const negativeTokenFiles = extractFiles(negativeToken);
      assert.equal(negativeTokenFiles.has('alpha.txt'), true);
      assert.equal(negativeTokenFiles.has('beta.txt'), false);

      const negativePhrase = await runFilterSearch({
        query: 'alpha -"alpha beta"'
      });
      const negativePhraseFiles = extractFiles(negativePhrase);
      assert.equal(negativePhraseFiles.has('beta.txt'), true);
      assert.equal(negativePhraseFiles.has('alpha.txt'), false);
    }
  },
  {
    name: 'quoted phrase explain output carries phrase score breakdown',
    async run() {
      const phraseSearch = await runFilterSearch({
        query: '"alpha beta"',
        args: ['--explain']
      });
      const phraseHits = phraseSearch.prose || [];
      assert.ok(phraseHits.length > 0);
      assert.equal((phraseHits[0]?.scoreBreakdown?.phrase?.matches || 0) > 0, true);
    }
  },
  {
    name: 'git metadata branch and chunk-author filters narrow prose hits correctly',
    async run() {
      if (!filterRepoContext.branchName) {
        return;
      }

      const branchMatch = await runFilterSearch({
        query: 'alpha',
        args: ['--branch', filterRepoContext.branchName]
      });
      assert.ok((branchMatch.prose || []).length > 0);

      const branchMiss = await runFilterSearch({
        query: 'alpha',
        args: ['--branch', 'no-such-branch']
      });
      assert.equal((branchMiss.prose || []).length, 0);

      const chunkAuthorAlice = await runFilterSearch({
        query: 'alpha',
        args: ['--chunk-author', 'Alice']
      });
      const aliceFiles = extractFiles(chunkAuthorAlice);
      assert.equal(aliceFiles.has('alpha.txt'), true);
      assert.equal(aliceFiles.has('beta.txt'), false);

      const chunkAuthorBob = await runFilterSearch({
        query: 'alpha',
        args: ['--chunk-author', 'Bob']
      });
      const bobFiles = extractFiles(chunkAuthorBob);
      assert.equal(bobFiles.has('beta.txt'), true);
      assert.equal(bobFiles.has('alpha.txt'), false);
    }
  },
  {
    name: 'churn filter accepts numeric thresholds and rejects invalid values',
    async run() {
      const defaultPayload = await runFilterSearch({
        query: 'alpha'
      });
      assert.ok((defaultPayload.prose || []).length > 0);

      const zeroPayload = await runFilterSearch({
        query: 'alpha',
        args: ['--churn', '0']
      });
      assert.ok((zeroPayload.prose || []).length > 0);

      const highPayload = await runFilterSearch({
        query: 'alpha',
        args: ['--churn', '999999']
      });
      assert.equal((highPayload.prose || []).length, 0);

      const invalidResult = runNode(
        [
          path.join(filterRepoContext.root, 'search.js'),
          'alpha',
          '--mode',
          'prose',
          '--json',
          '--no-ann',
          '--repo',
          filterRepoRoot,
          '--backend',
          'memory',
          '--churn',
          'not-a-number'
        ],
        'invalid churn filter search',
        filterRepoRoot,
        filterRepoEnv,
        { stdio: 'pipe', encoding: 'utf8', timeoutMs: 30 * 1000, allowFailure: true }
      );
      assert.notEqual(invalidResult.status, 0);
      assert.match(`${invalidResult.stdout || ''}\n${invalidResult.stderr || ''}`, /churn/i);
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('retrieval search filter git/prose contract test passed');
