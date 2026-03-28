#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { ensureSearchFiltersRepo, runFilterSearch } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const { repoRoot, env } = context;
const extractFiles = (payload, key = 'prose') =>
  new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const cases = [
  {
    name: 'punctuation tokens remain searchable in code mode',
    run() {
      const payload = runFilterSearch({
        repoRoot,
        env,
        query: '&&',
        mode: 'code'
      });
      assert.equal(extractFiles(payload, 'code').has('sample.js'), true);
    }
  },
  {
    name: 'token case sensitivity toggles prose matches',
    run() {
      const insensitive = runFilterSearch({
        repoRoot,
        env,
        query: 'AlphaCase'
      });
      assert.equal(extractFiles(insensitive).has('CaseFile.TXT'), true);

      const sensitive = runFilterSearch({
        repoRoot,
        env,
        query: 'AlphaCase',
        args: ['--case-tokens']
      });
      assert.equal(extractFiles(sensitive).has('CaseFile.TXT'), false);
    }
  },
  {
    name: 'file selectors support case-insensitive, strict, and regex matching',
    run() {
      const insensitive = runFilterSearch({
        repoRoot,
        env,
        query: 'alpha',
        args: ['--file', 'casefile.txt']
      });
      assert.equal(extractFiles(insensitive).has('CaseFile.TXT'), true);

      const sensitive = runFilterSearch({
        repoRoot,
        env,
        query: 'alpha',
        args: ['--file', 'casefile.txt', '--case-file']
      });
      assert.equal(extractFiles(sensitive).has('CaseFile.TXT'), false);

      const regex = runFilterSearch({
        repoRoot,
        env,
        query: 'alpha',
        args: ['--file', '/casefile\\.txt/']
      });
      assert.equal(extractFiles(regex).has('CaseFile.TXT'), true);
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('file and token selector contract matrix test passed');
