import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadAndValidateManifest } from '../../../src/index/validate/manifest.js';
import { createArtifactPresenceHelpers } from '../../../src/index/validate/presence.js';
import { validateIdPostings, validatePostingsDocIds, validateSqliteMetaV2Parity } from '../../../src/index/validate/checks.js';
import { validateOrderingLedger } from '../../../src/index/validate/ordering-ledger.js';
import { loadAndValidateChunkMeta } from '../../../src/index/validate/chunk-meta.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const temp = resolveTestCachePath(process.cwd(), `strict-validator-identities-${crypto.randomUUID()}`);
const reports = () => ({
  report: { issues: [], warnings: [], hints: [], orderingDrift: [] },
  modeReport: { ok: true, missing: [], warnings: [] }
});
try {
  await fs.mkdir(path.join(temp, 'pieces'), { recursive: true });
  let state = reports();
  validateIdPostings(state.report, 'code', 'ids', [[0, 0.5]], 2);
  validatePostingsDocIds(state.report, 'code', 'postings', [[[0.25, 1]]], 2);
  assert.equal(state.report.issues.length, 2, 'fractional IDs cannot name documents');
  state = reports();
  const meta = { chunkId: 'c', range: { start: 1, end: 2 }, types: { inferred: { x: [] } } };
  const reordered = { types: { inferred: { x: [] } }, range: { end: 2, start: 1 }, chunkId: 'c' };
  validateSqliteMetaV2Parity(state.report, 'code', [{ metaV2: meta }], [{ id: 0, chunk_id: 'c', metaV2_json: JSON.stringify(reordered) }]);
  assert.deepEqual(state.report.issues, [], 'object insertion order is not metadata identity');
  validateOrderingLedger({ ...state, orderingLedger: { stages: { 'stage1:code': { artifacts: {} } } }, orderingStrict: true, mode: 'code', indexState: { stage: 'stage2' } });
  assert.equal(state.modeReport.ok, false, 'another stage cannot satisfy requested stage proof');
  const payload = Buffer.from('{"value":17}\n');
  await fs.writeFile(path.join(temp, 'stats.json'), payload);
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [{ name: 'stats', path: 'stats.json', format: 'json', checksum: `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}` }] };
  await fs.writeFile(path.join(temp, 'pieces', 'manifest.json'), JSON.stringify(manifest));
  state = reports();
  const helpers = createArtifactPresenceHelpers({ ...state, mode: 'code', dir: temp, manifest, strict: false });
  assert.deepEqual(helpers.readJsonArtifact('stats'), { value: 17 }, 'non-strict listed JSON must still be read');
  await loadAndValidateManifest({ ...state, mode: 'code', dir: temp, strict: true });
  assert.equal(state.report.issues.some(issue => issue.includes('checksum')), false, 'correct SHA256 accepted');
  await fs.writeFile(path.join(temp, 'stats.json'), '{"value":18}\n');
  state = reports();
  await loadAndValidateManifest({ ...state, mode: 'code', dir: temp, strict: true });
  assert.equal(state.report.issues.some(issue => issue.includes('checksum mismatch')), true);
  await fs.writeFile(path.join(temp, 'chunk_meta.json'), '[]');
  state = reports();
  await loadAndValidateChunkMeta({ ...state, mode: 'code', dir: temp, manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [{ name: 'chunk_meta', path: 'missing.jsonl', format: 'jsonl' }] }, strict: true, readJsonArtifact: () => null, shouldLoadOptional: () => false, checkPresence: () => null, sqliteEnabled: false });
  assert.equal(state.modeReport.ok, false, 'diagnostic fallback cannot erase strict primary failure');
  assert.equal(state.report.issues.some(issue => issue.includes('primary load failed')), true);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
console.log('strict validator identities passed');
