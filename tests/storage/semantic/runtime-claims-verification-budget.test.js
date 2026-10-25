import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { compareRuntimeCaptures } from '../../../src/index/semantic/runtime/compare.js';
import { persistRuntimeDerivedClaims, queryRuntimeDerivedClaims } from '../../../src/index/semantic/runtime/claims.js';
import { classifyRuntimeEvidenceError } from '../../../src/integrations/tooling/runtime-evidence.js';
import { projectMcpDomainError } from '../../../src/integrations/mcp/domain-error.js';
import { getRuntimeClaimVerification } from '../../../src/shared/runtime-claim-verification.js';
import { createVerifiedRuntimeImportFixture } from '../../helpers/verified-runtime-import-fixture.js';

const fixture = await createVerifiedRuntimeImportFixture();
try {
  const profileInput = fixture.inputs.find(input => input.artifactId === 'work.cpuprofile');
  const profile = JSON.parse(await fs.readFile(profileInput.path, 'utf8'));
  const work = profile.nodes.find(node => node.callFrame.functionName === 'work');
  // Distinct retained observations at the same verified source position. The
  // extra descriptive producer field belongs to observations, not claim text.
  profile.nodes = [profile.nodes[0], ...Array.from({ length: 8 }, (_, index) => ({ ...structuredClone(work),
    id: index + 2, hitCount: 1, deoptReason: 'saved producer detail '.repeat(48) }))];
  profile.nodes[0].children = profile.nodes.slice(1).map(node => node.id);
  profile.samples = profile.nodes.slice(1).map(node => node.id); profile.timeDeltas = profile.samples.map(() => 1);
  fixture.capture.rawArtifacts = fixture.capture.rawArtifacts.filter(row => row.artifactId !== 'work.cpuprofile');
  fixture.inputs.splice(fixture.inputs.indexOf(profileInput), 1);
  await fixture.addRaw({ name: 'work.cpuprofile', format: 'inspector-cpu-profile', bytes: Buffer.from(JSON.stringify(profile)) });
  const first = await importRuntimeEvidence(fixture.options());
  const secondOptions = fixture.options(); secondOptions.capture = structuredClone(fixture.capture);
  secondOptions.capture.captureId = 'capture-b';
  secondOptions.capture.rawArtifacts.forEach(row => { row.captureId = 'capture-b'; });
  secondOptions.authority = { ...secondOptions.authority, captureId: 'capture-b' };
  const second = await importRuntimeEvidence(secondOptions), destination = secondOptions.destination;
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace,
    generation: fixture.capture.generation, leftFamily: first.pointer.generationId, rightFamily: second.pointer.generationId,
    sources: fixture.capture.sources, limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, persist: true };
  const compared = await compareRuntimeCaptures({ destination, request });
  assert.equal(compared.status, 'complete'); assert.equal(compared.claims.length, 1);
  const manifest = JSON.parse(await fs.readFile(path.join(destination, 'claims', compared.claimGeneration, 'manifest.json')));
  assert.equal(manifest.citations.length, 16, 'the discriminator uses real distinct observations in both captures');
  const halves = [0, 1].map(half => manifest.inputs.flatMap(pin => manifest.citations
    .filter(row => row.generationId === pin.generationId).slice(half * 4, half * 4 + 4).map(row => row.evidenceId)));
  const claims = halves.map((ids, index) => {
    const claim = structuredClone(compared.claims[0]); claim.evidenceId += ':page-' + index;
    claim.data.claim = 'These retained saved observations support this bounded editorial interpretation; no causality is asserted.';
    claim.data.supportingEvidenceIds = ids.slice(0, -1); claim.data.contradictingEvidenceIds = ids.slice(-1);
    return claim;
  });
  const generation = await persistRuntimeDerivedClaims({ ...request, destination, inputs: manifest.inputs,
    citations: manifest.citations, claims });
  const lookup = { schemaVersion: 1, repositoryNamespace: request.repositoryNamespace, generation: request.generation,
    claimGeneration: generation, limits: { ...request.limits, maxRecords: 1, maxBytes: 8192 }, cursor: null };
  const handles = new Set(), originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args), close = handle.close;
    handles.add(handle);
    handle.close = async (...closeArgs) => {
      const result = await close.call(handle, ...closeArgs); handles.delete(handle); return result;
    };
    return handle;
  };
  try {
    const page1 = await queryRuntimeDerivedClaims({ destination, request: lookup });
    assert.equal(page1.claims.length, 1); assert.ok(page1.nextCursor);
    assert.equal(page1.verification.scope, 'all-family-citations'); assert.equal(page1.verification.citationsVerified, true);
    assert.equal(page1.verification.cost.citationRows, 16);
    assert.ok(page1.verification.cost.hydratedBytes > lookup.limits.maxBytes,
      'valid all-family support exceeds the small response allowance without becoming corruption');
    assert.equal(page1.verification.cost.responseBytes, Buffer.byteLength(JSON.stringify(page1)));
    assert.ok(page1.verification.cost.responseBytes <= lookup.limits.maxBytes);
    const larger = await queryRuntimeDerivedClaims({ destination, request: { ...lookup,
      limits: { ...lookup.limits, maxBytes: 65536 } } });
    assert.equal(larger.claims[0].evidenceId, page1.claims[0].evidenceId);
    const page2 = await queryRuntimeDerivedClaims({ destination, request: { ...lookup, cursor: page1.nextCursor } });
    assert.equal(page2.nextCursor, null);
    assert.deepEqual([page1.claims[0].evidenceId, page2.claims[0].evidenceId], claims.map(row => row.evidenceId));
    const all = await queryRuntimeDerivedClaims({ destination, request: { ...lookup, limits: request.limits } });
    for (const page of [page1, page2]) {
      assert.equal(page.verification.cost.hydratedBytes, all.verification.cost.hydratedBytes);
      assert.equal(page.verification.cost.rawVerificationBytes, all.verification.cost.rawVerificationBytes);
      assert.equal(page.verification.cost.familyOpens, 2, 'every request retains the full verification promise');
    }
    assert.equal(page1.verification.cost.claimRowBytes + page2.verification.cost.claimRowBytes,
      all.verification.cost.claimRowBytes, 'selected row reads and full-family verification are distinct physical work');
    for (const [basis, verificationLimits] of [['hydratedBytes', { maxHydratedBytes: 1 }],
      ['citationRows', { maxCitationRows: 1 }], ['rawVerificationBytes', { maxRawVerificationBytes: 1 }]]) {
      await assert.rejects(queryRuntimeDerivedClaims({ destination, request: lookup, verificationLimits }), error => {
        assert.equal(error.code, 'ERR_RUNTIME_QUERY_BUDGET');
        const receipt = getRuntimeClaimVerification(error); assert.equal(receipt.refusal.basis, basis);
        assert.ok(receipt.refusal.consumed + receipt.refusal.required > receipt.refusal.limit);
        assert.equal(classifyRuntimeEvidenceError(error).status, 422);
        assert.deepEqual(projectMcpDomainError(error).runtimeClaimVerification, receipt); return true;
      });
      assert.equal(handles.size, 0, 'physical budget refusal closes all captured file handles');
    }
    const rawArtifact = fixture.capture.rawArtifacts.find(row => row.artifactId === 'work.cpuprofile');
    const rawFile = path.join(destination, 'raw', rawArtifact.hash + '.bin'), original = await fs.readFile(rawFile);
    const corrupt = Buffer.from(original); corrupt[5] ^= 1; await fs.writeFile(rawFile, corrupt);
    try { await assert.rejects(queryRuntimeDerivedClaims({ destination, request: lookup }), error => {
      assert.equal(error.code, 'ERR_RUNTIME_IMPORT_INTEGRITY'); assert.equal(classifyRuntimeEvidenceError(error).status, 409); return true;
    }); } finally { await fs.writeFile(rawFile, original); }
    const missing = rawFile + '.fixture-missing';
    await fs.rename(rawFile, missing);
    try { await assert.rejects(queryRuntimeDerivedClaims({ destination, request: lookup }), { code: 'ERR_RUNTIME_FAMILY_UNAVAILABLE' }); }
    finally { await fs.rename(missing, rawFile); }
    for (const changed of [{ repositoryNamespace: 'wrong-namespace' },
      { generation: { ...lookup.generation, semanticRevision: lookup.generation.semanticRevision + 1 } }]) {
      await assert.rejects(queryRuntimeDerivedClaims({ destination, request: { ...lookup, ...changed } }), { code: 'ERR_RUNTIME_QUERY_SCOPE' });
    }
    assert.equal(handles.size, 0);
    const fake = Object.assign(new Error('lookalike'), { code: 'ERR_RUNTIME_QUERY_BUDGET', runtimeClaimVerification: page1.verification });
    assert.equal(Object.hasOwn(classifyRuntimeEvidenceError(fake), 'runtimeClaimVerification'), false);
    assert.equal(Object.hasOwn(projectMcpDomainError(fake), 'runtimeClaimVerification'), false);
  } finally {
    fs.open = originalOpen;
    await Promise.all([...handles].map(handle => handle.close()));
  }
} finally { await fixture.cleanup(); }
console.log('Small claim pages retain full citation/raw integrity with distinct physical budgets, costs, and truthful typed refusals.');
