#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence, verifyRuntimeFamily } from '../../../src/index/semantic/runtime/import.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';

const fixture = await createRuntimeImportFixture();
try {
  const result = await importRuntimeEvidence(fixture.options());
  assert.equal(result.executionAuthorized, false);
  assert.ok(result.coverage.every(row => row.status === 'complete'));
  const rows = await fixture.readRows(result);
  assert.equal(rows.length, 7);
  assert.ok(rows.every(row => row.evidenceClass === 'observed'));
  const work = rows.find(row => row.kind === 'cpuProfile' && row.data.functionName === 'work');
  assert.equal(work.data.sampleCount, 2); assert.equal(work.data.duration, 30);
  assert.equal(work.data.lineNumber, 0); assert.equal(work.data.columnNumber, 0);
  assert.equal(work.join.quality, 'exact-source');
  assert.equal(work.join.sourceHash, fixture.source.byteHash);
  assert.equal(rows.find(row => row.kind === 'cpuProfile' && row.data.profileNodeId === 1).join.quality, 'unresolved');
  const versions = rows.filter(row => row.kind === 'codeVersion');
  assert.deepEqual(versions.map(row => row.data.tier), ['baseline', 'optimized']);
  assert.equal(versions[0].data.key.codeId, versions[1].data.key.codeId);
  assert.notEqual(versions[0].data.key.lifetimeId, versions[1].data.key.lifetimeId);
  const listing = rows.find(row => row.kind === 'nativeDisassembly');
  assert.ok(listing.rawRefs[0].byteRange.end > listing.rawRefs[0].byteRange.start);
  const verified = await verifyRuntimeFamily({ destination: fixture.options().destination });
  assert.ok(verified.manifest.raw.every(row => row.pinned));

  const rawOnly = fixture.options();
  rawOnly.capture = { ...fixture.capture, captureId: 'capture-profile-only', rawArtifacts: [
    { ...fixture.capture.rawArtifacts[0], captureId: 'capture-profile-only' }] };
  rawOnly.authority = { action: 'import-existing', captureId: rawOnly.capture.captureId, artifactHashes: [rawOnly.capture.rawArtifacts[0].hash] };
  rawOnly.inputs = fixture.inputs.slice(0, 1); rawOnly.destination = path.join(fixture.root, 'profile-only');
  const alone = await importRuntimeEvidence(rawOnly);
  const aloneRows = JSON.parse('[' + (await fs.readFile(path.join(rawOnly.destination, 'generations', alone.pointer.generationId, 'evidence.jsonl'), 'utf8')).trim().split('\n').join(',') + ']');
  assert.ok(aloneRows.every(row => row.join.quality === 'unresolved'), 'URLs and function names cannot authorize exact source joins');
  assert.notEqual(aloneRows[1].evidenceId, work.evidenceId, 'multiple captures never merge observation identities');

  const mismatch = { ...fixture.options(), destination: path.join(fixture.root, 'wrong-phase'),
    capture: { ...fixture.capture, workload: { ...fixture.capture.workload, phase: 'warmup' } } };
  const mismatched = await importRuntimeEvidence(mismatch);
  assert.ok(mismatched.coverage.find(row => row.artifactId === 'code-log-v1.jsonl').reasons.includes('log_header_version_or_scope_mismatch'));
  assert.equal(mismatched.capture.completion, 'partial');
  const ambiguous = fixture.options();
  ambiguous.destination = path.join(fixture.root, 'ambiguous');
  const other = { sourceUnitId: 'su1:' + '2'.repeat(64), byteHash: fixture.source.byteHash };
  ambiguous.capture = { ...fixture.capture, sources: [...fixture.capture.sources, other] };
  ambiguous.sourceCandidates = [...ambiguous.sourceCandidates, { sourceUnitId: other.sourceUnitId, sourceHash: other.byteHash, targets: [] }];
  const ambiguousResult = await importRuntimeEvidence(ambiguous);
  const bytes = await fs.readFile(path.join(ambiguous.destination, 'generations', ambiguousResult.pointer.generationId, 'evidence.jsonl'), 'utf8');
  assert.ok(bytes.includes('"quality":"ambiguous"'));
  console.log('saved CPU and versioned interchange adapters preserve exact coordinates, lifetimes, scope and join uncertainty');
} finally { await fixture.cleanup(); }
