import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverFiles } from '../../../src/index/build/discover.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-scm-'));
try {
  await fs.writeFile(path.join(root,'untracked.js'), 'export const value = 1;');
  for (const scmProvider of ['git', 'jj']) {
    const entries = await discoverFiles({ root, mode: 'code', scmProvider, scmRepoRoot: root,
      scmProviderImpl: { listTrackedFiles: async () => ({ filesPosix: [] }) } });
    assert.deepEqual(entries, [], `${scmProvider} empty success is authoritative`);
  }
  const fallback = await discoverFiles({ root, mode: 'code', scmProvider: 'git', scmRepoRoot: root,
    scmProviderImpl: { listTrackedFiles: async () => ({ ok: false, reason: 'unavailable' }) } });
  assert.ok(fallback.some(entry => entry.rel === 'untracked.js'));
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('empty SCM discovery authority passed');
