#!/usr/bin/env node
import assert from 'node:assert/strict';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { queryRuntimeEvidence, defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';
import { listRuntimeFamilies } from '../../../src/index/semantic/runtime/families.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';

const fixture = await createRuntimeImportFixture();
try {
  const first = await importRuntimeEvidence(fixture.options());
  const secondOptions = fixture.options();
  secondOptions.capture = structuredClone(fixture.capture);
  secondOptions.capture.captureId = 'capture-b'; secondOptions.capture.workload.phase = 'warmup';
  secondOptions.capture.scope = { ...secondOptions.capture.scope, processId: 'process-8', isolateId: 'isolate-2' };
  secondOptions.capture.rawArtifacts = [{ ...secondOptions.capture.rawArtifacts[0], captureId: 'capture-b' }];
  secondOptions.inputs = secondOptions.inputs.slice(0, 1);
  secondOptions.authority = { action: 'import-existing', captureId: 'capture-b', artifactHashes: [secondOptions.capture.rawArtifacts[0].hash] };
  const second = await importRuntimeEvidence(secondOptions);
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    familyGenerations: [first.pointer.generationId, second.pointer.generationId], selectors: defaultRuntimeQuerySelectors(),
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, cursor: null };
  const query = changes => queryRuntimeEvidence({ destination: fixture.options().destination,
    request: { ...request, selectors: { ...request.selectors, ...changes } } });
  const all = await query({});
  assert.equal(all.observations.length, 9, 'retained first family remains queryable after the current pointer changes');
  assert.equal(new Set(all.observations.map(row => row.evidenceId)).size, 9);
  assert.equal(all.derivedClaims.length, 0); assert.equal(all.executionAuthorized, false);
  assert.equal(all.derivedCoverage.state, 'unsupported');
  assert.equal(all.nextCursor, null); assert.equal(all.cost.responseBytes, Buffer.byteLength(JSON.stringify(all)));
  assert.ok(all.explanations.every(row => row.basis === 'direct-observation'));
  assert.ok(all.explanations.some(row => row.nextObservation?.action === 'plan-only' && row.nextObservation.executionAuthorized === false));
  const exact = await query({ sources: [{ sourceUnitId: fixture.source.sourceUnitId, byteHash: fixture.source.byteHash }] });
  assert.equal(exact.observations.length, 6); assert.ok(exact.observations.every(row => row.join.quality === 'exact-source'));
  assert.deepEqual(exact.coverage.map(row => row.sourceJoinCounts.exactSource), [6, 0]);
  assert.ok(exact.coverage[1].reasons.includes('exact_source_mapping_unavailable_in_saved_capture'));
  assert.equal(exact.status, 'partial', 'complete saved profiles do not imply complete source mapping');
  assert.equal((await query({ sources: [{ sourceUnitId: fixture.source.sourceUnitId, byteHash: 'a'.repeat(64) }] })).observations.length, 0);
  assert.equal((await query({ records: fixture.options().sourceCandidates[0].targets })).observations.length, 6);
  assert.equal((await query({ joinQualities: ['unresolved'] })).observations.length, 3);
  assert.equal((await query({ captureIds: ['capture-b'] })).observations.length, 2);
  assert.equal((await query({ workload: { fingerprint: fixture.capture.workload.fingerprint, phase: 'capture' } })).observations.length, 7);
  assert.equal((await query({ scope: fixture.capture.scope })).observations.length, 7);
  const { executableHash, nodeVersion, v8Version, os, architecture } = fixture.capture.runtime;
  assert.equal((await query({ runtime: { executableHash, nodeVersion: 'different-saved-version', v8Version, os, architecture } })).observations.length, 0);
  assert.equal((await query({ runtime: { executableHash, nodeVersion, v8Version, os, architecture } })).observations.length, 9);
  const key = { sessionId: fixture.capture.scope.sessionId, processId: fixture.capture.scope.processId, codeId: '0x100', lifetimeId: 'creation-1' };
  const lifetime = await query({ codeVersions: [key] });
  assert.equal(lifetime.observations.length, 3);
  assert.ok(lifetime.observations.every(row => row.data.key.lifetimeId === 'creation-1'));
  assert.equal((await query({ codeVersions: [{ ...key, lifetimeId: 'creation-2' }] })).observations.length, 1);
  const disassembly = await query({ kinds: ['nativeDisassembly'] });
  assert.equal(disassembly.observations.length, 1);
  assert.ok(disassembly.explanations[0].limitations.some(row => row.includes('custom saved interchange')));
  assert.equal((await query({ evidenceIds: [disassembly.observations[0].evidenceId] })).observations.length, 1);
  const derived = await query({ kinds: ['derivedClaim'] });
  assert.deepEqual(derived.derivedClaims, []); assert.equal(derived.status, 'partial');
  assert.ok(derived.warnings.includes('derived_claim_projection_not_supported_by_current_offline_adapters'));
  await assert.rejects(queryRuntimeEvidence({ destination: fixture.options().destination,
    request: { ...request, generation: { baseBuildId: 'another-build', semanticRevision: 0 } } }), { code: 'ERR_RUNTIME_QUERY_SCOPE' });
  await assert.rejects(queryRuntimeEvidence({ destination: fixture.options().destination,
    request: { ...request, repositoryNamespace: 'another-repository' } }), { code: 'ERR_RUNTIME_QUERY_SCOPE' });
  const discovery = await listRuntimeFamilies({ destination: fixture.options().destination, limit: 1 });
  assert.equal(discovery.families.length, 1); assert.ok(discovery.nextCursor);
  const nextDiscovery = await listRuntimeFamilies({ destination: fixture.options().destination, limit: 1, cursor: discovery.nextCursor });
  assert.equal(nextDiscovery.families.length, 1); assert.equal(nextDiscovery.nextCursor, null);
  assert.notEqual(nextDiscovery.families[0].generationId, discovery.families[0].generationId);
  const unsupportedOptions = fixture.options();
  unsupportedOptions.capture = { ...fixture.capture, rawArtifacts: [{ ...fixture.capture.rawArtifacts[0], format: 'unknown-saved-format' }] };
  unsupportedOptions.inputs = unsupportedOptions.inputs.slice(0, 1);
  unsupportedOptions.authority = { action: 'import-existing', captureId: fixture.capture.captureId,
    artifactHashes: [unsupportedOptions.capture.rawArtifacts[0].hash] };
  const unsupported = await importRuntimeEvidence(unsupportedOptions);
  const unavailableProjection = await queryRuntimeEvidence({ destination: fixture.options().destination,
    request: { ...request, familyGenerations: [unsupported.pointer.generationId] } });
  assert.deepEqual(unavailableProjection.observations, []); assert.equal(unavailableProjection.status, 'partial');
  assert.deepEqual(unavailableProjection.coverage[0].importStates, ['unsupported']);
  assert.ok(unavailableProjection.coverage[0].reasons.includes('unsupported_raw_format_or_version'));
  assert.equal(unavailableProjection.nextCursor, null, 'an available empty index preserves explicit unsupported projection coverage');
  console.log('pinned multi-capture runtime lookup keeps exact source, workload, executable, scope and code-lifetime selectors separate');
} finally { await fixture.cleanup(); }
