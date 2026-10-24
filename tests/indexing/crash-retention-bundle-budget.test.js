import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { retainCrashArtifacts } from '../../src/index/build/crash-log.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
const root = resolveTestCachePath(process.cwd(), `crash-retention-budget-${crypto.randomUUID()}`);
const repoCacheRoot = path.join(root, 'cache', 'repo');
const diagnosticsRoot = path.join(root, 'diagnostics');
try {
  const forensics = path.join(repoCacheRoot, 'logs', 'forensics');
  await fs.mkdir(forensics, { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'logs', 'index-crash-state.json'), '{"phase":"failure"}');
  const payload = JSON.stringify({ payload: 'x'.repeat(4 * 1024 * 1024) });
  for (let index = 0; index < 10; index += 1) {
    await fs.writeFile(path.join(forensics, `${String(index).padStart(2, '0')}.json`), payload);
  }
  const result = await retainCrashArtifacts({ repoCacheRoot, diagnosticsRoot });
  const bundle = JSON.parse(await fs.readFile(result.bundlePath, 'utf8'));
  assert.equal(bundle.copiedArtifacts.some(entry => entry.relativePath.endsWith('index-crash-state.json')), true);
  assert.equal(bundle.retentionDecisions.some(entry => entry.retentionKind === 'omitted'), true);
  const copiedBytes = bundle.copiedArtifacts.reduce((total, entry) => total + entry.bytes, 0);
  assert.equal(bundle.retentionPolicy.retainedBytesTotal, copiedBytes);
  const metadataBytes = (await fs.stat(result.bundlePath)).size + (await fs.stat(result.markerPath)).size;
  assert.ok(copiedBytes + metadataBytes <= bundle.retentionPolicy.bundleBudgetBytes);
  assert.equal(bundle.copyErrors.length, 0, 'budget omission is a recorded policy decision');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('crash retention bundle byte allowance passed');
