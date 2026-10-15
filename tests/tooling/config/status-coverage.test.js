import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readIndexCoverage, compareIndexRevision } from '../../../src/integrations/core/status-coverage.js';

assert.equal(compareIndexRevision({ commit: 'a', dirty: false }, { commit: 'b', dirty: false }), 'revision-changed');
assert.equal(compareIndexRevision({ commit: 'a', dirty: false }, { commit: 'a', dirty: true }), 'working-tree-unverified');
assert.equal(compareIndexRevision({ commit: 'a', dirty: false }, { commit: 'a', dirty: false }), 'same-clean-revision');
assert.equal(compareIndexRevision(null, { commit: 'a' }), 'unknown');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-coverage-'));
try {
  const indexDir = path.join(root, 'active');
  await fs.writeFile(path.join(root, 'index-code.json'), JSON.stringify({
    indexDir, generatedAt: '2026-10-14', files: { scanned: 8, skipped: 2, skippedByReason: { tooLarge: 2 } }, chunks: { total: 12 }
  }));
  const read = (target) => readIndexCoverage({ metricsDir: root, repoCacheRoot: root, indexes: { code: target } });
  assert.equal(read(indexDir).modes.code.files.skipped, 2);
  assert.equal(read(indexDir).workingTreeComparison, 'not-performed');
  assert.equal(read(path.join(root, 'other')).modes.code.status, 'unavailable', 'old metrics cannot describe a different active index');
  await fs.writeFile(path.join(root, 'watch-state.json'), '{bad');
  assert.equal(read(indexDir).watcher, null);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('coverage is bounded, generation-associated and honest about live freshness');
