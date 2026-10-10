#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence, verifyRuntimeFamily } from '../../../src/index/semantic/runtime/import.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { assertRuntimeFamily } from '../../../src/contracts/validators/runtime-evidence-family.js';

const fixture = await createRuntimeImportFixture();
try {
  const account = createSemanticDiskAccount(16 * 1024 * 1024);
  const options = { ...fixture.options(), diskAccount: account };
  const first = await importRuntimeEvidence(options);
  const currentPath = path.join(options.destination, 'current.json');
  const previous = await fs.readFile(currentPath);
  assert.throws(() => assertRuntimeFamily('pointer', { ...first.pointer, artifactSurfaceVersion: '0.0.0' }), { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
  const charged = account.used;
  const rawInputs = first.capture.rawArtifacts.map(row => ({ artifactId: row.artifactId, path: path.join(options.destination, row.storageRef) }));
  const reingested = await importRuntimeEvidence({ ...options, inputs: rawInputs });
  assert.equal(reingested.pointer.generationId, first.pointer.generationId, 'reingestion uses retained bytes with no workload execution');
  assert.equal(account.used, charged, 'immutable raw and existing generation never receive a second disk charge');
  await assert.rejects(importRuntimeEvidence({ ...options, authority: { ...options.authority, action: 'execute' } }), { code: 'ERR_RUNTIME_IMPORT_AUTHORITY' });
  await fs.appendFile(fixture.inputs[0].path, ' ');
  await assert.rejects(importRuntimeEvidence(options), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
  assert.deepEqual(await fs.readFile(currentPath), previous, 'tampered source authority cannot replace prior pointer');
  const original = await fs.readFile(fixture.inputs[0].path);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(importRuntimeEvidence({ ...options, inputs: rawInputs, signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(await fs.readFile(fixture.inputs[0].path), original, 'import failure preserves original saved input');
  const midImport = new AbortController();
  let reservations = 0;
  const abortingAccount = { reserve: bytes => {
    account.reserve(bytes); reservations += 1; midImport.abort();
  }, release: bytes => account.release(bytes) };
  await assert.rejects(importRuntimeEvidence({ ...options, inputs: rawInputs, signal: midImport.signal, diskAccount: abortingAccount }),
    { name: 'AbortError' });
  assert.equal(reservations, 1, 'cancellation happens after the first projection append reservation');
  assert.equal(account.used, charged, 'cancelled append releases every owned staging byte');
  assert.deepEqual(await fs.readFile(currentPath), previous);
  assert.ok((await fs.readdir(path.join(options.destination, 'generations'))).every(name => !name.startsWith('.pending-')));

  const limited = createSemanticDiskAccount(64);
  await assert.rejects(importRuntimeEvidence({ ...options, inputs: rawInputs, destination: path.join(fixture.root, 'denied'), diskAccount: limited }),
    { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal(limited.used, 0);
  const overReserve = { ...options, inputs: rawInputs,
    capture: { ...fixture.capture, limits: { ...fixture.capture.limits, diskReserveBytes: Number.MAX_SAFE_INTEGER } } };
  await assert.rejects(importRuntimeEvidence(overReserve), { code: 'ERR_RUNTIME_DISK_RESERVE' });
  assert.deepEqual(await fs.readFile(currentPath), previous);
  const zeroReserve = { ...options, inputs: rawInputs, destination: path.join(fixture.root, 'zero-reserve'),
    capture: { ...fixture.capture, limits: { ...fixture.capture.limits, diskReserveBytes: 0 } } };
  const noReserve = await importRuntimeEvidence(zeroReserve);
  assert.equal(noReserve.recordCount, 7, 'zero minimum free reserve does not become a zero output cap');
  assert.equal(noReserve.capture.limits.diskReserveBytes, 0);
  const explicitLimit = createSemanticDiskAccount(16 * 1024 * 1024);
  await assert.rejects(importRuntimeEvidence({ ...zeroReserve, destination: path.join(fixture.root, 'explicit-limit'),
    importOptions: { maxDiskWorkingSetBytes: 1 }, diskAccount: explicitLimit }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal(explicitLimit.used, 0, 'explicit import working set remains enforced with a larger shared account');
  const truncated = await fixture.addRaw({ name: 'truncated.cpuprofile', format: 'inspector-cpu-profile', bytes: Buffer.from('{"nodes":[') });
  await fixture.addRaw({ name: 'unknown.log', format: 'future-native-log', formatVersion: '99', bytes: Buffer.from('unparsed raw\n') });
  const partial = await importRuntimeEvidence({ ...fixture.options(), inputs: [...rawInputs, ...fixture.inputs.slice(2)] });
  assert.equal(partial.capture.completion, 'partial');
  assert.equal(partial.coverage.find(row => row.artifactId === truncated.artifactId).status, 'malformed');
  assert.equal(partial.coverage.find(row => row.artifactId === 'unknown.log').status, 'unsupported');
  await verifyRuntimeFamily({ destination: options.destination });
  const manifest = JSON.parse(await fs.readFile(path.join(options.destination, 'generations', partial.pointer.generationId, 'manifest.json'), 'utf8'));
  await fs.appendFile(path.join(options.destination, manifest.raw[0].path), 'x');
  await assert.rejects(verifyRuntimeFamily({ destination: options.destination }), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
  console.log('runtime CAS reingestion, exact authority, failure recovery, budgets and unknown/truncated coverage passed');
} finally { await fixture.cleanup(); }
