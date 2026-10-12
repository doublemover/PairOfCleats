import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntimeImportFixture } from './runtime-import-fixture.js';
import { applyTestEnv } from './test-env.js';
import { importRuntimeEvidence } from '../../src/index/semantic/runtime/import.js';

/** Saved synthetic capture joined to actual retained published SSR source.
 * No live attach/capture is performed or implied by this qualification helper. */
export const createPublishedRuntimeWitness = async (witness, { signal = null } = {}) => {
  const testConfig = process.env.PAIROFCLEATS_TEST_CONFIG;
  const fixture = await createRuntimeImportFixture();
  try {
    const source = [...witness.sources.values()].find(row => row.path === 'snapshot.ts');
    const functions = witness.records.filter(row => row.kind === 'scope' && row.data.scopeKind === 'FunctionDeclaration'
      && row.sourceUnitId === source.sourceUnitId).sort((a, b) => a.span[0] - b.span[0]);
    assert.equal(functions.length, 2);
    const log = (await fs.readFile(fixture.inputs[1].path, 'utf8')).trim().split('\n').map(JSON.parse);
    for (const row of log.slice(1)) {
      row.sourceHash = source.byteHash;
      if (row.kind === 'scriptMetadata') row.data.contentHash = source.byteHash;
    }
    const profile = { nodes: functions.map((row, index) => {
      let line = source.lineStarts.length - 1;
      while (source.lineStarts[line] > row.span[0]) line -= 1;
      return { id: index + 1, callFrame: { functionName: index ? 'render' : 'build', scriptId: '42', url: source.path,
        lineNumber: line, columnNumber: row.span[0] - source.lineStarts[line] } };
    }), startTime: 0, endTime: 20, samples: [1, 2], timeDeltas: [10, 10] };
    const logArtifact = await fixture.addRaw({ name: 'witness-log.jsonl', bytes: Buffer.from(log.map(row => JSON.stringify(row)).join('\n') + '\n'), format: 'pairofcleats-code-log' });
    const profileArtifact = await fixture.addRaw({ name: 'witness.cpuprofile', bytes: Buffer.from(JSON.stringify(profile)), format: 'inspector-cpu-profile' });
    const original = fixture.options();
    const base = { ...original, destination: path.join(witness.repoRoot, 'runtime-import'), inputs: fixture.inputs.slice(-2),
      capture: { ...fixture.capture, repositoryNamespace: source.repositoryNamespace, generation: witness.manifest.generation,
        sources: [...witness.sources.values()].map(row => ({ sourceUnitId: row.sourceUnitId, byteHash: row.byteHash })), rawArtifacts: [logArtifact, profileArtifact],
        workload: { ...fixture.capture.workload, description: 'synthetic saved SSR fixture; no live capture' },
        warnings: [...fixture.capture.warnings, 'synthetic saved SSR fixture; no live capture; measurements are synthetic'] },
      sourceCandidates: [{ sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, targets: functions.map(row => row.ref) }],
      semanticContext: witness.semanticContext,
      authority: { ...original.authority, artifactHashes: [logArtifact.hash, profileArtifact.hash] } };
    applyTestEnv({ cacheRoot: witness.cacheRoot, embeddings: 'stub', testConfig: testConfig ? JSON.parse(testConfig) : undefined });
    const options = captureId => {
      const capture = structuredClone(base.capture);
      capture.captureId = captureId; capture.rawArtifacts.forEach(row => { row.captureId = captureId; });
      return { ...base, capture, authority: { ...base.authority, captureId } };
    };
    const first = await importRuntimeEvidence({ ...options('capture-a'), signal });
    const second = await importRuntimeEvidence({ ...options('capture-b'), signal });
    return { first, second, source, functions, base, options, cleanup: fixture.cleanup };
  } catch (error) { await fixture.cleanup(); throw error; }
};
