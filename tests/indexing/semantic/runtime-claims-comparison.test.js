#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { compareRuntimeCaptures } from '../../../src/index/semantic/runtime/compare.js';
import { queryRuntimeDerivedClaims, persistRuntimeDerivedClaims } from '../../../src/index/semantic/runtime/claims.js';
import { runtimeCaptureCompatibility } from '../../../src/index/semantic/runtime/compatibility.js';
import { runtimeByteHash } from '../../../src/index/semantic/runtime/raw-store.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';

const fixture = await createRuntimeImportFixture();
try {
  const options = fixture.options(), first = await importRuntimeEvidence(options);
  const original = await fs.readFile(fixture.inputs[0].path);
  const profile = JSON.parse(original); profile.samples = [2, 2, 2, 2]; profile.timeDeltas = [10, 10, 10, 10];
  const bytes = Buffer.from(JSON.stringify(profile)), filename = path.join(fixture.root, 'second.cpuprofile');
  await fs.writeFile(filename, bytes);
  const secondOptions = fixture.options(); secondOptions.capture = structuredClone(fixture.capture);
  secondOptions.capture.captureId = 'capture-b';
  secondOptions.capture.rawArtifacts = secondOptions.capture.rawArtifacts.map(raw => ({ ...raw, captureId: 'capture-b' }));
  Object.assign(secondOptions.capture.rawArtifacts[0], { hash: runtimeByteHash(bytes), byteLength: bytes.length });
  secondOptions.inputs = [{ ...fixture.inputs[0], path: filename }, fixture.inputs[1]];
  secondOptions.authority = { action: 'import-existing', captureId: 'capture-b', artifactHashes: secondOptions.capture.rawArtifacts.map(row => row.hash) };
  const second = await importRuntimeEvidence(secondOptions);
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    leftFamily: first.pointer.generationId, rightFamily: second.pointer.generationId, sources: fixture.capture.sources,
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, persist: true };
  const result = await compareRuntimeCaptures({ destination: options.destination, request });
  assert.equal(result.status, 'complete'); assert.equal(result.claims.length, 1); assert.equal(result.executionAuthorized, false);
  assert.match(result.claims[0].data.claim, /2 attributed samples.*4 in capture-b/);
  assert.equal(result.claims[0].data.supportingEvidenceIds.length, 2);
  assert.deepEqual(result.claims[0].data.contradictingEvidenceIds, []);
  assert.ok(result.claims[0].unavailable.includes('causal-inference'));
  assert.match(result.claims[0].data.nextObservation.permissionRequirements[0], /authorization/);
  const lookup = { schemaVersion: 1, repositoryNamespace: request.repositoryNamespace, generation: request.generation,
    claimGeneration: result.claimGeneration, limits: request.limits, cursor: null };
  const saved = await queryRuntimeDerivedClaims({ destination: options.destination, request: lookup });
  assert.deepEqual(saved.claims, result.claims); assert.equal(saved.nextCursor, null);
  assert.equal(saved.integrity, 'claims-and-cited-observations-verified');
  const again = await compareRuntimeCaptures({ destination: options.destination, request });
  assert.equal(again.claimGeneration, result.claimGeneration, 'reingestion is deterministic and does not replace observations');
  assert.deepEqual(await fs.readFile(fixture.inputs[0].path), original);
  const manifest = JSON.parse(await fs.readFile(path.join(options.destination, 'claims', result.claimGeneration, 'manifest.json')));
  const invalid = structuredClone(result.claims); invalid[0].data.contradictingEvidenceIds = ['absent'];
  await assert.rejects(persistRuntimeDerivedClaims({ destination: options.destination, ...request, inputs: manifest.inputs,
    citations: manifest.citations, claims: invalid }), { code: 'ERR_RUNTIME_CLAIMS_INTEGRITY' });
  for (const field of ['runtime', 'clock', 'scope', 'sources', 'instrumentation']) {
    const changed = structuredClone(fixture.capture);
    if (field === 'runtime') changed.runtime.nodeVersion = 'different';
    if (field === 'clock') changed.clock.origin = 'different';
    if (field === 'scope') changed.scope.processId = 'other';
    if (field === 'sources') changed.sources[0].byteHash = '0'.repeat(64);
    if (field === 'instrumentation') changed.instrumentation.debugger = true;
    assert.ok(runtimeCaptureCompatibility(fixture.capture, changed).includes('different_' + field));
  }
  const changed = structuredClone(fixture.capture); changed.workload.phase = 'warmup';
  assert.ok(runtimeCaptureCompatibility(fixture.capture, changed).includes('different_workload_phase'));
  const incompatible = await compareRuntimeCaptures({ destination: options.destination, request: { ...request, rightFamily: request.leftFamily } });
  assert.equal(incompatible.status, 'incompatible'); assert.equal(incompatible.claimGeneration, null);
  const beforeIncompatible = await fs.readFile(path.join(options.destination, 'claims', 'current.json'));
  const thirdOptions = { ...secondOptions, capture: structuredClone(secondOptions.capture) };
  thirdOptions.capture.captureId = 'capture-c'; thirdOptions.capture.clock.domain = 'different-saved-clock';
  thirdOptions.capture.rawArtifacts.forEach(raw => { raw.captureId = 'capture-c'; });
  thirdOptions.authority = { ...secondOptions.authority, captureId: 'capture-c' };
  const third = await importRuntimeEvidence(thirdOptions);
  const clocks = await compareRuntimeCaptures({ destination: options.destination, request: { ...request, rightFamily: third.pointer.generationId } });
  assert.equal(clocks.status, 'incompatible'); assert.ok(clocks.reasons.includes('different_clock')); assert.deepEqual(clocks.claims, []);
  assert.deepEqual(await fs.readFile(path.join(options.destination, 'claims', 'current.json')), beforeIncompatible);
  await assert.rejects(compareRuntimeCaptures({ destination: options.destination, request: { ...request, limits: { ...request.limits, maxRecords: 1 } } }), { code: 'ERR_RUNTIME_QUERY_BUDGET' });
  await assert.rejects(queryRuntimeDerivedClaims({ destination: options.destination, request: { ...lookup, repositoryNamespace: 'elsewhere' } }), { code: 'ERR_RUNTIME_QUERY_SCOPE' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(compareRuntimeCaptures({ destination: options.destination, request, signal: controller.signal }), { code: 'ABORT_ERR' });
  console.log('runtime saved comparison and immutable claim citations passed');
} finally { await fixture.cleanup(); }
