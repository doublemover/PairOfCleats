import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRepoTrusted } from '../../src/shared/config-authority.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'PoC-Trust-Identity-'));
const repo = path.join(root, 'Repo');
const nested = path.join(repo, 'nested');
const sibling = path.join(root, 'Repo-other');
for (const directory of [nested, sibling]) fs.mkdirSync(directory, { recursive: true });
const env = { PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]) };
try {
  assert.equal(isRepoTrusted(repo, env), true);
  assert.equal(isRepoTrusted(root, env), false, 'a child grant cannot trust its parent');
  assert.equal(isRepoTrusted(nested, env), false, 'a grant does not include nested repositories');
  assert.equal(isRepoTrusted(sibling, env), false, 'a common path prefix is not identity');
  assert.equal(isRepoTrusted(repo, { PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify(['Repo']) }), false);
  assert.equal(isRepoTrusted(repo, { PAIROFCLEATS_TRUSTED_REPOS: '{invalid' }), false);
  assert.equal(isRepoTrusted(path.join(root, 'missing'), env), false);
  if (process.platform === 'win32') {
    assert.equal(isRepoTrusted(repo.toLowerCase(), env), true,
      'native filesystem identity survives the case normalization used by MCP');
    assert.equal(isRepoTrusted(repo, { PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo.toLowerCase()]) }), true);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Repository trust uses exact native filesystem identity');
