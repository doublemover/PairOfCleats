#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { projectTriageEvidence } from '../../../tools/triage/evidence.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const repoA = path.resolve('.tmp/triage-evidence-a'), repoB = path.resolve('.tmp/triage-evidence-b');
const freshness = { buildId: 'build-before', generationKey: 'generation-before', activeBuildRoot: repoA,
  profileId: 'fixture', signature: 'original-index-signature', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION };
const hit = { file: 'src/util.js', chunkUid: 'independent-comment-chunk', start: 0, end: 30,
  startLine: 1, endLine: 2, headline: 'sentinel '.repeat(90), score: 0, scoreType: 'sparse' };
const payload = { extractedProse: [hit], backend: 'memory', retrieval: {
  backend: { selected: 'memory', requested: 'auto', defaultBackend: 'sqlite', selectionKind: 'policy',
    selectionReason: 'fixture', forced: false, availabilityDriven: false },
  fidelity: { status: 'complete', fallbackDerived: false },
  freshness: { byMode: { extractedProse: freshness }, activeGeneration: null, asOf: null },
  cache: { hit: false, strategy: 'memory', memoryHotPath: false }
} };
const project = (body, overrides = {}) => projectTriageEvidence({ repoRoot: repoA, query: 'sentinel',
  mode: 'extracted-prose', result: { ok: true, payload: body }, limit: 5, ...overrides });
const saved = JSON.parse(JSON.stringify(project(payload)));
assert.equal(saved.status, 'success');
assert.equal(saved.hits[0].source.chunkUid, 'independent-comment-chunk');
assert.deepEqual(saved.retrieval.freshness.mode, freshness);
assert.equal(saved.hits[0].source.offsets.start, 0);
assert.equal(saved.hits[0].score, 0);
assert.equal(saved.hits[0].snippet.length, 240);
assert.deepEqual(saved.hits[0].preview, { lossy: true, exactSourceSupport: false, truncated: true });
const other = project(payload, { repoRoot: repoB });
assert.notEqual(other.repository.root, saved.repository.root);
payload.retrieval.freshness.byMode.extractedProse.generationKey = 'generation-after';
hit.headline = 'changed current bytes';
const current = project(payload);
assert.notEqual(current.retrieval.freshness.mode.generationKey, saved.retrieval.freshness.mode.generationKey);
assert.notEqual(current.hits[0].snippet, saved.hits[0].snippet);
assert.deepEqual(saved.hits[0].source.navigation, { status: 'unavailable', reason: 'source-not-revalidated' });
assert.equal(saved.retrieval.freshness.mode.generationKey, 'generation-before');
for (const body of [{ code: [hit] }, { extractedProse: null }, { extractedProse: {} },
  { extractedProse: [null] }, { extractedProse: [], ok: false }]) {
  const row = project(body);
  assert.equal(row.status, 'unavailable');
  assert.equal(row.diagnostic.code, 'ERR_TRIAGE_EVIDENCE_RESPONSE');
  assert.deepEqual(row.hits, []);
}
const empty = project({ extractedProse: [] });
assert.equal(empty.status, 'empty');
assert.equal(empty.diagnostic, null);
assert.equal(empty.retrieval.backend.selected, null);
assert.equal(empty.retrieval.freshness.mode, null);
const unknown = project({ extractedProse: [{ file: 'src/util.js', startLine: null, endLine: '5' }] });
assert.equal(unknown.hits[0].source.chunkUid, null);
assert.equal(unknown.hits[0].source.lines.status, 'unknown');
assert.equal(unknown.hits[0].source.offsets.status, 'unknown');
const failed = project(null, { result: { ok: false, code: 'ERR_QUERY', error: 'Fixture failure' } });
assert.equal(failed.status, 'unavailable');
assert.deepEqual(failed.diagnostic, { code: 'ERR_QUERY', message: 'Fixture failure' });
assert.equal(failed.mode, 'extracted-prose');
assert.equal(failed.query, 'sentinel');
assert.equal(failed.repository.root, repoA);
console.log('Triage selected cohorts retain source receipts and explicit unavailable outcomes.');
