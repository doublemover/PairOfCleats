import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { loadJsonArrayArtifact, loadMinhashSignatures, resolveArtifactPresence } from '../../../src/shared/artifact-io.js';
import { MINHASH_HASH_IDENTITY } from '../../../src/index/minhash.js';

applyTestEnv();
const cases = ['manifest', 'flow-data', 'minhash-missing-identity', 'minhash-stale-identity'];
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/fixtures/health-authority/')[1];
if (selected) assert.ok(cases.includes(selected));
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./health-authority.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases });
for (const caseId of selected ? [selected] : cases) {
  const options = { fixtureName: 'risk-interprocedural/js-simple',
    cacheName: `fixture-health-authority-${caseId}-${process.pid}`, cacheScope: 'isolated',
    requireRiskTags: true, requiredModes: ['code'],
    envOverrides: { PAIROFCLEATS_TEST_CONFIG: JSON.stringify(createFastIndexingTestConfig()) } };
  const first = await ensureFixtureIndex(options);
  assert.ok((await loadJsonArrayArtifact(first.codeDir, 'risk_flows')).length > 0);
  const warm = await ensureFixtureIndex(options);
  assert.equal(warm.codeDir, first.codeDir, 'unchanged warm health evidence avoids a rebuild');
  if (caseId === 'manifest') {
    const manifestPath = path.join(first.codeDir, 'pieces/manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const body = manifest.fields || manifest;
    body.pieces = body.pieces.filter(piece => !piece.name.startsWith('risk_flows'));
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
  } else if (caseId === 'flow-data') {
    const file = resolveArtifactPresence(first.codeDir, 'risk_flows').paths[0];
    const original = await fs.readFile(file);
    await fs.writeFile(file, Buffer.alloc(original.length, 0x20));
    assert.equal((await fs.stat(file)).size, original.length, 'tamper preserves the original data size');
  } else {
    const file = resolveArtifactPresence(first.codeDir, 'minhash_signatures').paths.find(file => file.endsWith('.json'));
    assert.ok(file, 'small fixture publishes its JSON signatures');
    const payload = JSON.parse(await fs.readFile(file, 'utf8'));
    if (caseId === 'minhash-missing-identity') delete payload.hashIdentity;
    else payload.hashIdentity = 'legacy-polynomial-v1';
    await fs.writeFile(file, JSON.stringify(payload));
    await assert.rejects(loadMinhashSignatures(first.codeDir), { code: 'ERR_ARTIFACT_INVALID' });
  }
  const repaired = await ensureFixtureIndex(options);
  assert.notEqual(repaired.codeDir, first.codeDir, `a stale health stamp cannot admit mutated ${caseId}`);
  assert.ok((await loadJsonArrayArtifact(repaired.codeDir, 'risk_flows')).length > 0,
    'rebuild restores the required positive flow rather than skipping parity coverage');
  assert.equal((await loadMinhashSignatures(repaired.codeDir)).hashIdentity, MINHASH_HASH_IDENTITY);
}
console.log('Fresh, warm and mutated fixture health authority checks passed');
