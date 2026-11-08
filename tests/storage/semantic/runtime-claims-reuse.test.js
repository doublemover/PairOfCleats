import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { compareRuntimeCaptures } from '../../../src/index/semantic/runtime/compare.js';
import { persistRuntimeDerivedClaims, queryRuntimeDerivedClaims } from '../../../src/index/semantic/runtime/claims.js';
import { openRuntimeQueryFamily } from '../../../src/index/semantic/runtime/query-store.js';
import { withRuntimeDestinationWriter } from '../../../src/index/semantic/runtime/ownership.js';
import { getRuntimeClaimPublication } from '../../../src/shared/runtime-claim-publication.js';
import { createVerifiedRuntimeImportFixture } from '../../helpers/verified-runtime-import-fixture.js';
import { admitRuntimeHeadroom, retainedRuntimeBytes, runtimeFamilySnapshot,
  observeRuntimePublicationWork, assertNoRuntimeFamilyWrites, runRuntimeReuseChild } from '../../helpers/runtime-publication-work.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('storage/semantic/runtime-claims-reuse/')[1];
assert.ok(['repeat', 'fresh-process', 'pointer-missing', 'pointer-older', 'interrupted', 'corrupt-manifest',
  'corrupt-evidence', 'corrupt-offsets', 'corrupt-support', 'new-content'].includes(mode));
const fixture = await createVerifiedRuntimeImportFixture();
let pinned;
try {
  const options = fixture.options(), destination = options.destination;
  const first = await importRuntimeEvidence(options);
  const secondOptions = { ...options, capture: structuredClone(fixture.capture) };
  secondOptions.capture.captureId = 'capture-b';
  secondOptions.capture.rawArtifacts.forEach(row => { row.captureId = 'capture-b'; });
  secondOptions.authority = { ...options.authority, captureId: 'capture-b' };
  const second = await importRuntimeEvidence(secondOptions);
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    leftFamily: first.pointer.generationId, rightFamily: second.pointer.generationId, sources: fixture.capture.sources,
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, persist: true };
  const comparison = await compareRuntimeCaptures({ destination, request });
  assert.equal(comparison.status, 'complete'); assert.ok(comparison.claimGeneration); assert.ok(comparison.claims.length);
  const root = path.join(destination, 'claims');
  const manifest = JSON.parse(await fs.readFile(path.join(root, comparison.claimGeneration, 'manifest.json'), 'utf8'));
  const publish = (claims = comparison.claims, extra = {}) => persistRuntimeDerivedClaims({ destination,
    repositoryNamespace: request.repositoryNamespace, generation: request.generation, limits: request.limits,
    inputs: manifest.inputs, citations: manifest.citations, claims, ...extra });
  const changed = structuredClone(comparison.claims);
  changed[0].evidenceId += ':separate-interpretation'; changed[0].data.claim += ' A separate saved interpretation.';
  let claims = comparison.claims, generation = comparison.claimGeneration;
  const pointerRepair = ['pointer-missing', 'pointer-older', 'interrupted'].includes(mode);
  if (mode === 'pointer-missing') await fs.unlink(path.join(root, 'current.json'));
  if (mode === 'pointer-older') assert.notEqual(await publish(changed), generation);
  if (mode === 'interrupted') {
    const controller = new AbortController(), rename = fs.rename;
    fs.rename = async (from, to) => {
      const result = await rename(from, to);
      if (path.dirname(to) === root && /^[a-f0-9]{64}$/.test(path.basename(to))) controller.abort();
      return result;
    };
    try {
      await assert.rejects(publish(changed, { signal: controller.signal }), error => {
        assert.equal(error.code, 'ABORT_ERR'); const receipt = getRuntimeClaimPublication(error);
        assert.equal(receipt.familyState, 'promoted'); assert.equal(receipt.pointerState, 'not-started');
        generation = receipt.claimGeneration; return true;
      });
    } finally { fs.rename = rename; }
    claims = changed;
  }
  const family = path.join(root, generation), before = await runtimeFamilySnapshot(family);
  const familyBytes = before.reduce((sum, row) => sum + Number(row.size), 0);
  assert.ok(familyBytes > 1024, 'another complete claim family exceeds the control headroom');
  const damaged = { 'corrupt-manifest': path.join(family, 'manifest.json'), 'corrupt-evidence': path.join(family, 'claims.jsonl'),
    'corrupt-offsets': path.join(family, 'claims.offsets'),
    'corrupt-support': path.join(destination, 'raw', fixture.capture.rawArtifacts[0].hash + '.bin') }[mode];
  if (damaged) {
    const bytes = await fs.readFile(damaged); bytes[0] ^= 1; await fs.writeFile(damaged, bytes);
    const metrics = {}, originalPointer = await fs.readFile(path.join(root, 'current.json'));
    const observed = await observeRuntimePublicationWork(destination, async () => {
      await assert.rejects(publish(claims, { publicationMetrics: metrics }),
        { code: mode === 'corrupt-manifest' ? 'ERR_RUNTIME_CLAIMS_INTEGRITY' : 'ERR_RUNTIME_IMPORT_INTEGRITY' });
    });
    assertNoRuntimeFamilyWrites(observed.witness); assert.equal(metrics.reusedFamilies, 0);
    assert.deepEqual(await fs.readFile(path.join(root, 'current.json')), originalPointer);
    console.log(JSON.stringify({ mode, familyBytes, metrics, witness: observed.witness }));
  } else {
    pinned = await openRuntimeQueryFamily({ destination, generationId: first.pointer.generationId });
    if (mode === 'repeat') {
      const comfortableMetrics = {};
      const comfortable = await observeRuntimePublicationWork(destination, () => publish(claims, { publicationMetrics: comfortableMetrics }));
      console.log(JSON.stringify({ mode, control: 'comfortable-cap', metrics: comfortableMetrics, witness: comfortable.witness }));
      assert.equal(comfortable.value, generation); assertNoRuntimeFamilyWrites(comfortable.witness);
    }
    const admitted = await admitRuntimeHeadroom(destination), metrics = {};
    if (mode === 'new-content') {
      const originalPointer = await fs.readFile(path.join(root, 'current.json'));
      await assert.rejects(publish(changed, { publicationMetrics: metrics }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
      assert.equal(metrics.reusedFamilies, 0);
      assert.deepEqual(await fs.readFile(path.join(root, 'current.json')), originalPointer);
      await withRuntimeDestinationWriter({ destination, maxDiskWorkingSetBytes: 16 * 1024 * 1024 }, () => {});
      const rebuilt = await observeRuntimePublicationWork(destination, () => publish(changed, { publicationMetrics: metrics }));
      assert.notEqual(rebuilt.value, generation); assert.equal(metrics.rebuiltFamilies, 1);
      assert.equal(metrics.reusedFamilies, 0); assert.equal(rebuilt.witness.staging.length, 1);
      console.log(JSON.stringify({ mode, familyBytes, admitted, metrics, witness: rebuilt.witness }));
    } else {
      let repeated;
      if (mode === 'fresh-process') {
        const child = await runRuntimeReuseChild({ kind: 'claims', requestFile: path.join(fixture.root, 'reuse-request.json'),
          options: { destination, repositoryNamespace: request.repositoryNamespace, generation: request.generation,
            limits: request.limits, inputs: manifest.inputs, citations: manifest.citations, claims } });
        repeated = child; Object.assign(metrics, child.metrics);
      } else repeated = await observeRuntimePublicationWork(destination, () => publish(claims, { publicationMetrics: metrics }));
      assert.equal(repeated.value, generation); assertNoRuntimeFamilyWrites(repeated.witness);
      assert.equal(metrics.reusedFamilies, 1); assert.equal(metrics.rebuiltFamilies, 0);
      assert.equal(metrics.sqliteBuilds, 0); assert.equal(metrics.projectionRows, 0);
      assert.equal(metrics.pointerOnlyRepairs, Number(pointerRepair));
      assert.ok(metrics.peakAdditionalReservation <= admitted.headroom);
      assert.ok(metrics.verifiedBytes > familyBytes, 'current raw/support authority is verified as well as claim members');
      assert.equal(repeated.witness.writes.filter(row => /^claims\/\.current-/.test(row.path)).length, Number(pointerRepair));
      assert.deepEqual(repeated.witness.controlPublications.map(row => row.path), pointerRepair ? ['claims/current.json'] : [],
        'claim recovery publishes only its actual selected convenience pointer');
      assert.deepEqual(await runtimeFamilySnapshot(family), before);
      const hydrated = await queryRuntimeDerivedClaims({ destination, request: { schemaVersion: 1,
        repositoryNamespace: request.repositoryNamespace, generation: request.generation, claimGeneration: generation,
        limits: request.limits, cursor: null } });
      assert.deepEqual(hydrated.claims, claims);
      assert.ok(await retainedRuntimeBytes(destination) <= admitted.limit);
      console.log(JSON.stringify({ mode, familyBytes, admitted, metrics, witness: repeated.witness }));
    }
    const row = pinned.db.prepare('SELECT * FROM evidence ORDER BY ordinal LIMIT 1').get();
    assert.ok(await pinned.hydrate(row, 65536), 'pinned original support remains readable after claim reuse/recovery');
  }
} finally { await pinned?.close(); await fixture.cleanup(); }
