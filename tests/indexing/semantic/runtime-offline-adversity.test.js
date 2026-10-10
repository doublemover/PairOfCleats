#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';

const fixture = await createRuntimeImportFixture();
try {
  const originalLog = (await fs.readFile(fixture.inputs[1].path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const stale = structuredClone(originalLog[3]);
  const scopeMismatch = structuredClone(originalLog[2]); scopeMismatch.data.key.processId = 'other-process';
  const badListing = structuredClone(originalLog[3]); badListing.listing = 'changed untrusted listing';
  const malformed = { ...originalLog[1], extraFutureField: true };
  const contradictoryScript = structuredClone(originalLog[1]); contradictoryScript.data.contentHash = 'a'.repeat(64);
  const adversarial = [originalLog[0], originalLog[2], originalLog[4], stale, scopeMismatch, badListing, malformed,
    contradictoryScript, { schemaVersion: 2, kind: 'futureTier' }].map(row => JSON.stringify(row)).join('\n') + '\n{"truncated":';
  await fixture.addRaw({ name: 'adversity.jsonl', format: 'pairofcleats-code-log', bytes: Buffer.from(adversarial) });
  const result = await importRuntimeEvidence(fixture.options());
  const coverage = result.coverage.find(row => row.artifactId === 'adversity.jsonl');
  assert.equal(coverage.status, 'partial');
  for (const reason of ['unresolved_or_retired_code_lifetime', 'malformed_or_cross_scope_log_record',
    'disassembly_listing_hash_mismatch', 'unknown_log_record_version_kind_or_fields', 'truncated_log_line']) {
    assert.ok(coverage.reasons.includes(reason), reason);
  }
  const rows = await fixture.readRows(result);
  assert.ok(rows.every(row => row.evidenceClass === 'observed' && row.scope.processId === 'process-7'));
  assert.equal(rows.filter(row => row.rawRefs[0].artifactId === 'adversity.jsonl').length, 2,
    'only valid creation and retirement are projected; rejected details stay raw');

  const bounded = fixture.options(); bounded.destination = path.join(fixture.root, 'bounded');
  bounded.capture = { ...fixture.capture, limits: { ...fixture.capture.limits, maxSamples: 1 } };
  const capped = await importRuntimeEvidence(bounded);
  assert.ok(capped.coverage.find(row => row.artifactId === 'work.cpuprofile').reasons.includes('profile_sample_limit'));
  assert.equal(capped.capture.completion, 'partial');
  const tiny = fixture.options(); tiny.destination = path.join(fixture.root, 'tiny');
  tiny.capture = { ...fixture.capture, rawArtifacts: fixture.capture.rawArtifacts.slice(0, 1),
    limits: { ...fixture.capture.limits, processTreeMemoryBytes: 12 } };
  tiny.inputs = fixture.inputs.slice(0, 1); tiny.authority = { ...tiny.authority, artifactHashes: [tiny.capture.rawArtifacts[0].hash] };
  const unavailable = await importRuntimeEvidence(tiny);
  assert.equal(unavailable.recordCount, 0);
  assert.equal(unavailable.coverage[0].status, 'unsupported');
  assert.ok(unavailable.coverage[0].reasons.includes('profile_resident_allowance_exceeded'));
  console.log('runtime saved adapters reject cross-scope, retired, unknown, contradictory, truncated and over-budget input explicitly');
} finally { await fixture.cleanup(); }
