#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { compareRuntimeCaptures } from '../../../src/index/semantic/runtime/compare.js';
import { persistRuntimeDerivedClaims, queryRuntimeDerivedClaims } from '../../../src/index/semantic/runtime/claims.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
const fixture = await createRuntimeImportFixture();
try {
  const first = await importRuntimeEvidence(fixture.options());
  const options = fixture.options(); options.capture = structuredClone(fixture.capture); options.capture.captureId = 'capture-b';
  options.capture.rawArtifacts.forEach(row => { row.captureId = 'capture-b'; }); options.authority = { ...options.authority, captureId: 'capture-b' };
  const second = await importRuntimeEvidence(options), destination = options.destination;
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    leftFamily: first.pointer.generationId, rightFamily: second.pointer.generationId, sources: fixture.capture.sources,
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, persist: true };
  const result = await compareRuntimeCaptures({ destination, request });
  const root = path.join(destination, 'claims'), family = path.join(root, result.claimGeneration);
  const pointer = await fs.readFile(path.join(root, 'current.json'));
  const manifest = JSON.parse(await fs.readFile(path.join(family, 'manifest.json')));
  const lookup = { schemaVersion: 1, repositoryNamespace: request.repositoryNamespace, generation: request.generation,
    claimGeneration: result.claimGeneration, limits: request.limits, cursor: null };
  const publish = (claims, signal = null) => persistRuntimeDerivedClaims({ destination, ...request, inputs: manifest.inputs, citations: manifest.citations, claims, signal });
  const altered = structuredClone(result.claims); altered[0].data.claim += ' A separate retained editorial interpretation.';
  altered[0].evidenceId += ':edited';
  const oldRename = fs.rename;
  fs.rename = async (from, to) => { if (to === path.join(root, 'current.json')) throw Object.assign(new Error('injected publication failure'), { code: 'EIO' }); return oldRename(from, to); };
  try { await assert.rejects(publish(altered), /injected publication failure/); }
  finally { fs.rename = oldRename; }
  assert.deepEqual(await fs.readFile(path.join(root, 'current.json')), pointer);
  assert.ok((await fs.readdir(root)).every(name => !name.startsWith('.pending-') && !name.startsWith('.current-')));
  assert.deepEqual((await queryRuntimeDerivedClaims({ destination, request: lookup })).claims, result.claims);
  const offsetsFile = path.join(family, 'claims.offsets'), offsets = await fs.readFile(offsetsFile);
  await fs.writeFile(offsetsFile, Buffer.alloc(offsets.length, 1));
  await assert.rejects(queryRuntimeDerivedClaims({ destination, request: lookup }), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
  await fs.writeFile(offsetsFile, offsets);
  const evidenceFile = path.join(family, 'claims.jsonl'), evidence = await fs.readFile(evidenceFile);
  const tampered = Buffer.from(evidence); tampered[5] ^= 1; await fs.writeFile(evidenceFile, tampered);
  await assert.rejects(queryRuntimeDerivedClaims({ destination, request: lookup }), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
  await fs.writeFile(evidenceFile, evidence);
  const rawFile = path.join(destination, 'raw', fixture.capture.rawArtifacts[0].hash + '.bin'), raw = await fs.readFile(rawFile);
  const changedRaw = Buffer.from(raw); changedRaw[3] ^= 1; await fs.writeFile(rawFile, changedRaw);
  await assert.rejects(queryRuntimeDerivedClaims({ destination, request: lookup }), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
  await assert.rejects(publish(altered), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
  assert.deepEqual(await fs.readFile(path.join(root, 'current.json')), pointer);
  await fs.writeFile(rawFile, raw);
  const contradicted = structuredClone(result.claims); contradicted[0].data.supportingEvidenceIds.splice(1, 1);
  contradicted[0].data.contradictingEvidenceIds = [result.claims[0].data.supportingEvidenceIds[1]];
  contradicted[0].data.claim = 'Saved observations support competing interpretations; no causality asserted.';
  contradicted[0].evidenceId += ':contradiction';
  const generation = await publish(contradicted);
  const cited = await queryRuntimeDerivedClaims({ destination, request: { ...lookup, claimGeneration: generation } });
  assert.equal(cited.claims[0].data.contradictingEvidenceIds.length, 1);
  assert.deepEqual((await queryRuntimeDerivedClaims({ destination, request: lookup })).claims, result.claims, 'prior immutable family remains queryable');
  const invalid = structuredClone(contradicted); invalid[0].data.supportingEvidenceIds = ['unknown'];
  await assert.rejects(publish(invalid), { code: 'ERR_RUNTIME_CLAIMS_INTEGRITY' });
  const two = structuredClone(contradicted); two.push({ ...structuredClone(contradicted[0]), evidenceId: contradicted[0].evidenceId + ':second' });
  const twoGeneration = await publish(two);
  const paged = { ...lookup, claimGeneration: twoGeneration, limits: { ...lookup.limits, maxRecords: 1 } };
  const page1 = await queryRuntimeDerivedClaims({ destination, request: paged });
  assert.equal(page1.claims.length, 1); assert.ok(page1.nextCursor);
  const page2 = await queryRuntimeDerivedClaims({ destination, request: { ...paged, cursor: page1.nextCursor } });
  assert.equal(page2.claims.length, 1); assert.equal(page2.nextCursor, null);
  assert.notEqual(page1.claims[0].evidenceId, page2.claims[0].evidenceId);
  await assert.rejects(queryRuntimeDerivedClaims({ destination, request: { ...paged, limits: lookup.limits, cursor: page1.nextCursor } }), { code: 'ERR_RUNTIME_QUERY_CURSOR' });
  const beforeCancel = await fs.readFile(path.join(root, 'current.json'));
  const controller = new AbortController(), cancelClaims = structuredClone(two); cancelClaims[0].evidenceId += ':cancel';
  fs.rename = async (from, to) => {
    const value = await oldRename(from, to);
    if (path.dirname(to) === root && /^[a-f0-9]{64}$/.test(path.basename(to))) controller.abort();
    return value;
  };
  try { await assert.rejects(publish(cancelClaims, controller.signal), { code: 'ABORT_ERR' }); }
  finally { fs.rename = oldRename; }
  assert.deepEqual(await fs.readFile(path.join(root, 'current.json')), beforeCancel);
  assert.ok((await fs.readdir(root)).every(name => !name.startsWith('.pending-') && !name.startsWith('.current-')));
  console.log('runtime claim recovery/raw authority/contradiction retention passed');
} finally { await fixture.cleanup(); }
