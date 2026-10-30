import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { compareRuntimeCaptures, selectRuntimeClaimCitations } from '../../../src/index/semantic/runtime/compare.js';
import { persistRuntimeDerivedClaims, queryRuntimeDerivedClaims } from '../../../src/index/semantic/runtime/claims.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { createVerifiedRuntimeImportFixture } from '../../helpers/verified-runtime-import-fixture.js';

const fixture = await createVerifiedRuntimeImportFixture();
try {
  const profile = JSON.parse(await fs.readFile(fixture.inputs[0].path, 'utf8'));
  const unmatched = column => {
    const value = structuredClone(profile);
    value.nodes.find(node => node.id === 2).callFrame.columnNumber = column;
    return Buffer.from(JSON.stringify(value));
  };
  const leftRaw = await fixture.addRaw({ name: 'unmatched-left.cpuprofile', format: 'inspector-cpu-profile', bytes: unmatched(1) });
  const first = await importRuntimeEvidence(fixture.options());
  const rightRaw = await fixture.addRaw({ name: 'unmatched-right.cpuprofile', format: 'inspector-cpu-profile', bytes: unmatched(2) });
  const secondOptions = fixture.options(); secondOptions.capture = structuredClone(fixture.capture);
  secondOptions.capture.captureId = 'capture-b';
  secondOptions.capture.rawArtifacts = secondOptions.capture.rawArtifacts.filter(row => row.artifactId !== leftRaw.artifactId)
    .map(row => ({ ...row, captureId: 'capture-b' }));
  secondOptions.inputs = secondOptions.inputs.filter(row => row.artifactId !== leftRaw.artifactId);
  secondOptions.authority = { action: 'import-existing', captureId: 'capture-b', artifactHashes: secondOptions.capture.rawArtifacts.map(row => row.hash) };
  const second = await importRuntimeEvidence(secondOptions), destination = secondOptions.destination;
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    leftFamily: first.pointer.generationId, rightFamily: second.pointer.generationId, sources: fixture.capture.sources,
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, persist: true };
  const result = await compareRuntimeCaptures({ destination, request });
  assert.equal(result.status, 'partial'); assert.ok(result.reasons.includes('matching_source_location_unavailable'));
  assert.equal(result.claims.length, 1); assert.equal(result.claims[0].data.method.version, SEMANTIC_ANALYSIS_VERSIONS.runtimeClaims);
  const manifest = JSON.parse(await fs.readFile(path.join(destination, 'claims', result.claimGeneration, 'manifest.json')));
  const required = [...new Set(result.claims.flatMap(row => [...row.data.supportingEvidenceIds, ...row.data.contradictingEvidenceIds]))].sort();
  assert.deepEqual(manifest.citations.map(row => row.evidenceId).sort(), required);
  assert.equal(manifest.citations.length, 2, 'only the two matched profile observations are retained claim dependencies');
  const rawNames = new Set([leftRaw.hash + '.bin', rightRaw.hash + '.bin']);
  const opened = [], originalOpen = fs.open;
  const lookup = { schemaVersion: 1, repositoryNamespace: request.repositoryNamespace, generation: request.generation,
    claimGeneration: result.claimGeneration, limits: { ...request.limits, maxRecords: 1, maxBytes: 8192 }, cursor: null };
  try {
    fs.open = async function (filename, ...args) { opened.push(String(filename)); return originalOpen.call(fs, filename, ...args); };
    const saved = await queryRuntimeDerivedClaims({ destination, request: lookup });
    assert.deepEqual(saved.claims, result.claims);
    assert.equal(saved.verification.cost.citationRows, 2);
    assert.equal(opened.some(filename => rawNames.has(path.basename(filename))), false, 'unmatched raw artifacts are not hydrated or hashed as claim dependencies');
  } finally { fs.open = originalOpen; }
  const duplicate = [...manifest.citations, { ...manifest.citations[0] }];
  assert.deepEqual(selectRuntimeClaimCitations(result.claims, duplicate), manifest.citations);
  const conflict = [...manifest.citations, { ...manifest.citations[0], rowHash: '0'.repeat(64) }];
  assert.throws(() => selectRuntimeClaimCitations(result.claims, conflict), { code: 'ERR_RUNTIME_CLAIMS_INTEGRITY' });
  assert.throws(() => selectRuntimeClaimCitations(result.claims, manifest.citations.slice(1)), { code: 'ERR_RUNTIME_CLAIMS_INTEGRITY' });
  const contradictory = structuredClone(result.claims[0]); contradictory.evidenceId += ':contradiction-control';
  contradictory.data.contradictingEvidenceIds = contradictory.data.supportingEvidenceIds.splice(1);
  const closure = selectRuntimeClaimCitations([contradictory], manifest.citations);
  assert.equal(closure.length, 2, 'contradiction is part of the same exact closure');
  const generation = await persistRuntimeDerivedClaims({ destination, ...request, inputs: manifest.inputs, citations: closure, claims: [contradictory] });
  assert.deepEqual((await queryRuntimeDerivedClaims({ destination, request: { ...lookup, claimGeneration: generation } })).claims, [contradictory]);
  const unused = path.join(destination, 'raw', leftRaw.hash + '.bin'); await fs.writeFile(unused, 'irrelevant damaged retained artifact');
  assert.deepEqual((await queryRuntimeDerivedClaims({ destination, request: lookup })).claims, result.claims);
  const needed = fixture.capture.rawArtifacts.find(row => row.artifactId === 'work.cpuprofile');
  await fs.writeFile(path.join(destination, 'raw', needed.hash + '.bin'), 'damaged actual support');
  await assert.rejects(queryRuntimeDerivedClaims({ destination, request: lookup }), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
} finally { await fixture.cleanup(); }
console.log('Runtime comparison persists exact support and contradiction closure while retaining partial matching and required raw integrity.');
