import path from 'node:path';
import fs from 'node:fs/promises';
import Database from 'better-sqlite3';
import { normalizeSemanticConfig } from '../../src/index/semantic/config.js';
import { createAnalysisPartitionId } from '../../src/index/semantic/identity.js';
import { createSemanticFactsRef } from '../../src/index/semantic/file-ref.js';
import { writeSemanticAnalysis } from '../../src/index/semantic/analysis-write.js';
import { openSemanticFrontier } from '../../src/index/semantic/frontier.js';
import { throwIfAborted } from '../../src/shared/abort.js';
import { createSemanticCacheFixture } from './semantic-cache-fixture.js';
import { enqueueSemanticArtifacts } from '../../src/index/build/artifacts/writers/semantic/family.js';
import { writeArtifactPublicationRecord } from '../../src/index/build/artifact-publication.js';
import { checksumFile } from '../../src/shared/hash.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { seedPublishedArtifacts } from './artifact-publication.js';

export const writeBindingFixtureFamily = async ({ state, runtime, buildId }) => {
  const { outDir, manifestPath, pieceEntries } = await seedPublishedArtifacts({ buildRoot: runtime.buildRoot, buildId });
  const queue = [];
  enqueueSemanticArtifacts({ state, root: runtime.root, outDir, indexState: { buildId }, enabled: true,
    enqueueWrite: (_label, fn) => queue.push(fn), declareArtifactFamily: () => {},
    addPieceFile: (piece, filename) => pieceEntries.push({ ...piece, path: path.relative(outDir, filename).split(path.sep).join('/') }) });
  for (const write of queue) await write();
  for (const piece of pieceEntries) {
    const checksum = await checksumFile(path.join(outDir, piece.path));
    piece.checksum = checksum.algo + ':' + checksum.value;
  }
  await fs.writeFile(manifestPath, JSON.stringify({ version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    mode: 'code', stage: 'stage2', buildId, pieces: pieceEntries }));
  const writeRecord = () => writeArtifactPublicationRecord({ buildRoot: runtime.buildRoot,
    outDir, mode: 'code', stage: 'stage2', buildId, pieceEntries, manifestPath });
  await writeRecord();
  return { outDir, manifestPath, writeRecord };
};

export const createBindingWorkFixture = async ({ bindings = 'deferred', deferredDrain = 'manual', afterIndexMaxMs = 30000 } = {}) => {
  const fixture = await createSemanticCacheFixture();
  await fs.writeFile(path.join(fixture.repoRoot, 'tsconfig.json'), JSON.stringify({compilerOptions:{allowJs:true,types:[],target:'ES2022'},include:['*.js']}));
  const files = [await fixture.createFile(), await fixture.createFile({ file: 'other.js' })];
  const state = { semanticFactsByFile: new Map(files.map(file => [file.file, file.factsRef])), semanticDiskAccount: fixture.account };
  const runtime = { root: fixture.repoRoot, buildRoot: fixture.buildRoot, repoCacheRoot: path.join(fixture.root, 'control-cache'),
    semanticFrontierDatabase: Database, semanticPolicy: normalizeSemanticConfig({ enabled: true,
      enrichment: { bindings }, execution: { deferredDrain, afterIndexMaxMs } }),
    scheduler: { stats: () => ({tokens:{mem:{total:4,used:0}},adaptive:{memoryPerTokenMb:768,maxInFlightBytes:null},queues:{relations:{maxInFlightBytes:null,maxPendingBytes:null}}}), schedule: async (lane, options, fn) => {
      if (lane !== 'relations') throw new Error('Binding work must use existing relations lane.');
      throwIfAborted(options.signal); return fn();
    } } };
  const openControl = () => openSemanticFrontier({ Database, filename: path.join(runtime.repoCacheRoot, 'semantic-frontier', 'control.sqlite') });
  const emitBindings = async ({ signal, onlyFirst = false } = {}) => {
    const partitions = [];
    for (const file of (onlyFirst ? files.slice(0, 1) : files)) {
      const current = state.semanticFactsByFile.get(file.file);
      const partitionId = createAnalysisPartitionId({ pass: { name: 'fixture-binding', version: '1' },
        inputPartitionHashes: [file.partition.canonicalHash], compilerContext: null,
        dependencySummaryHashes: [], analysisPolicy: { fixture: true } });
      const coverage = { scope: { sourceUnitId: file.source.sourceUnitId }, phase: 'bindings', state: 'complete',
        reason: null, observedCount: 0, completedCount: 0, frontierRef: null };
      const partition = await writeSemanticAnalysis({ rows: [{ family: 'coverage', row: coverage }], policy: runtime.semanticPolicy,
        stagingRoot: path.join(runtime.buildRoot, current.storage.relativePath), source: file.source, sourceBytes: file.bytes,
        partitionId, producerHash: 'c'.repeat(64), policyHash: 'd'.repeat(64), diskAccount: fixture.account, signal });
      partitions.push(partition);
      state.semanticFactsByFile.set(file.file, createSemanticFactsRef({ source: file.source, storage: current.storage,
        syntaxPartitionId: current.syntaxPartitionId, partitions: [...current.partitions.filter(row => row.partitionId !== partitionId), partition],
        coverage: [...current.coverage.filter(row => row.phase !== 'bindings'), coverage] }));
    }
    return { schemaVersion: 1, contexts: [], partitions, coverageRef: null, diagnosticsRef: null };
  };
  return { ...fixture, files, state, runtime, emitBindings, openControl };
};
