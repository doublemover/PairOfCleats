import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** An explicit previously reviewed mapping in a task-owned fixture checkout.
 * It does not weaken production identity/admission checks or auto-confirm UI. */
export function prepareServiceMappingFixture(harness, { repoRoot, baseUrl = 'http://127.0.0.1:4311',
  serviceRoot = repoRoot, commit = 'a'.repeat(40) } = {}) {
  assert.notEqual(path.resolve(repoRoot), process.cwd(), 'mapping fixture must never modify the author checkout');
  const marker = path.join(repoRoot, '.git');
  assert.equal(fs.existsSync(marker), false, 'use a fresh fixture root with no real Git ownership');
  fs.mkdirSync(marker);
  fs.writeFileSync(path.join(marker, 'HEAD'), `${commit}\n`);
  const editorUri = harness.fakeVscode.Uri.file(repoRoot).toString();
  harness.workspaceStateStore.set('pairofcleats.serviceRepositories', {
    [`${baseUrl}::${editorUri}`]: { serviceRoot, editorUri, commit, verifiedAt: '2026-10-22T00:00:00.000Z' }
  });
  return { serviceRoot, commit, status: {
    ok: true, status: { coverage: { currentProvenance: { provider: 'git', head: { commitId: commit }, dirty: false } },
      repo: { root: serviceRoot, cacheRoot: '<redacted:absolute-path>', totalBytes: 0,
        sqlite: { code: true, prose: false, extractedProse: false, records: false } },
      health: { issues: [], hints: [] } }
  } };
}
