#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { createInProcessFilterSearch, ensureSearchFiltersRepo } from '../../../helpers/search-filters-repo.js';

const context = await ensureSearchFiltersRepo();
if (!context) process.exit(0);

const runFilterSearch = createInProcessFilterSearch({ repoRoot: context.repoRoot, env: context.env });
const extractFiles = (payload, key = 'prose') =>
  new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const cases = [
  {
    name: 'punctuation tokens remain searchable in code mode',
    async run() {
      const payload = await runFilterSearch({
        query: '&&',
        mode: 'code'
      });
      assert.equal(extractFiles(payload, 'code').has('sample.js'), true);
    }
  },
  {
    name: 'token case sensitivity toggles prose matches',
    async run() {
      const insensitive = await runFilterSearch({
        query: 'AlphaCase'
      });
      assert.equal(extractFiles(insensitive).has('CaseFile.TXT'), true);

      const sensitive = await runFilterSearch({
        query: 'AlphaCase',
        args: ['--case-tokens']
      });
      assert.equal(extractFiles(sensitive).has('CaseFile.TXT'), false);
    }
  },
  {
    name: 'file selectors support case-insensitive, strict, and regex matching',
    async run() {
      const insensitive = await runFilterSearch({
        query: 'alpha',
        args: ['--file', 'casefile.txt']
      });
      assert.equal(extractFiles(insensitive).has('CaseFile.TXT'), true);

      const sensitive = await runFilterSearch({
        query: 'alpha',
        args: ['--file', 'casefile.txt', '--case-file']
      });
      assert.equal(extractFiles(sensitive).has('CaseFile.TXT'), false);

      const regex = await runFilterSearch({
        query: 'alpha',
        args: ['--file', '/casefile\\.txt/']
      });
      assert.equal(extractFiles(regex).has('CaseFile.TXT'), true);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('file and token selector contract matrix test passed');
