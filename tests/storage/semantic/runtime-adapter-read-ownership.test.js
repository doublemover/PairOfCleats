import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { adaptCpuProfile } from '../../../src/index/semantic/runtime/adapters/cpu-profile.js';
import { createAdapterCoverage } from '../../../src/index/semantic/runtime/adapters/shared.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { installContainedReadFault, containsOriginalFailure } from '../../helpers/contained-read-fault.js';

const fixture = await createRuntimeImportFixture(), installed = [];
const artifact = fixture.capture.rawArtifacts.find(row => row.format === 'inspector-cpu-profile');
const filename = fixture.inputs.find(row => row.artifactId === artifact.artifactId).path;
const collect = async (input = {}) => {
  const coverage = createAdapterCoverage(input.artifact || artifact), rows = [];
  for await (const row of adaptCpuProfile({ filename, artifact, capture: fixture.capture,
    sourceCandidates: fixture.options().sourceCandidates, scriptHashes: new Map(), coverage, ...input })) rows.push(row);
  return { rows, coverage };
};
const fault = options => { const result = installContainedReadFault(options); installed.push(result); return result; };
const recover = async (failure, scope) => {
  const session = getContainedFileSession(failure); assert.ok(session);
  assert.equal(scope.states.length, 1); const state = scope.states[0], reads = state.reads;
  assert.equal(state.closes, 1); assert.equal(failure.cacheOwnershipReleased(), false);
  state.allowClose = true;
  assert.equal((await session.releaseAfterClose()).settled, true);
  assert.equal(state.reads, reads, 'close-only recovery cannot resume parsing or reread bytes');
  assert.equal(state.closes, 2); assert.equal(state.handle.fd, -1);
  assert.equal(failure.cacheOwnershipReleased(), true); scope.restore();
};
try {
  assert.ok((await collect()).rows.length > 0, 'valid saved profile remains a positive control');
  for (const cancel of [false, true]) {
    const controller = new AbortController(), original = Object.freeze(new Error('original adapter close rejected'));
    const scope = fault({ filename, failClose: () => { if (cancel) controller.abort(); throw original; } });
    let failure;
    try { await collect({ signal: controller.signal }); } catch (error) { failure = error; }
    assert.ok(failure); assert.equal(containsOriginalFailure(failure, original), true);
    await recover(failure, scope);
  }
  {
    const original = Object.freeze(Object.defineProperty(new Error('unreadable original'), 'message', {
      get() { throw new Error('diagnostic getter failed'); }
    }));
    const scope = fault({ filename, failClose: () => { throw original; } });
    let failure; try { await collect(); } catch (error) { failure = error; }
    assert.equal(containsOriginalFailure(failure, original), true); await recover(failure, scope);
  }
  {
    const original = Object.freeze(Object.assign(new Error('original read failed'), { code: 'EIO' }));
    const scope = fault({ filename, failRead: () => { throw original; } });
    await assert.rejects(collect(), error => containsOriginalFailure(error, original));
    assert.equal(scope.states.length, 1); assert.equal(scope.states[0].closed, true); scope.restore();
  }
  for (const changed of [{ hash: '0'.repeat(64) }, { byteLength: artifact.byteLength + 1 }]) {
    await assert.rejects(collect({ artifact: { ...artifact, ...changed } }), error =>
      error.code === 'ERR_FILE_INTEGRITY' || error.code === 'ERR_FILE_CHANGED');
  }
  for (const bytes of [Buffer.from('{"nodes":['), Buffer.from([0xc3, 0x28])]) {
    const malformed = await fixture.addRaw({ name: `malformed-${bytes.length}.cpuprofile`, format: 'inspector-cpu-profile', bytes });
    const result = await collect({ filename: fixture.inputs.at(-1).path, artifact: malformed });
    assert.equal(result.coverage.status, 'malformed'); assert.deepEqual(result.rows, []);
    assert.deepEqual(result.coverage.reasons, ['malformed_or_truncated_profile']);
  }
  // Prime a real family, then reject only the adapter's actual contained read of
  // its retained raw blob. String-flag hashing and later verification are intact.
  const first = await importRuntimeEvidence(fixture.options());
  const current = path.join(fixture.options().destination, 'current.json'), previous = await fs.readFile(current);
  const retained = first.capture.rawArtifacts.find(row => row.artifactId === artifact.artifactId);
  const original = Object.freeze(new Error('full import original descriptor close'));
  const scope = fault({ filename: path.join(fixture.options().destination, retained.storageRef), failClose: () => { throw original; } });
  let failure; try { await importRuntimeEvidence(fixture.options()); } catch (error) { failure = error; }
  assert.ok(failure); assert.equal(containsOriginalFailure(failure, original), true);
  assert.deepEqual(await fs.readFile(current), previous);
  await recover(failure, scope);
  assert.deepEqual(await fs.readFile(current), previous, 'recovery cannot publish a pointer');
} finally {
  for (const scope of installed) await scope.cleanup();
  await fixture.cleanup();
}
console.log('Actual profile FileHandle ownership survives direct/import classification, cancellation and close-only recovery.');
