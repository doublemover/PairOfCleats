import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSemanticSourceSnapshot } from '../../src/index/semantic/source.js';
import { runtimeByteHash } from '../../src/index/semantic/runtime/raw-store.js';
import { applyTestEnv } from './test-env.js';

export const createRuntimeImportFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-import-'));
  applyTestEnv({ cacheRoot: path.join(root, 'cache') });
  const source = createSemanticSourceSnapshot({ bytes: Buffer.from('function work(x) { return x + 1; }\n'),
    repositoryNamespace: 'runtime-fixture', path: 'work.js', language: 'javascript' }).manifest;
  const producer = { id: 'saved-fixture', version: '1' };
  const capture = { schemaVersion: 1, captureId: 'capture-a', requestId: 'request-a', question: 'Which saved code ran?',
    repositoryNamespace: 'runtime-fixture', generation: { baseBuildId: 'saved-build', semanticRevision: 0 },
    sources: [{ sourceUnitId: source.sourceUnitId, byteHash: source.byteHash }],
    runtime: { executableHash: 'e'.repeat(64), nodeVersion: '26.8.1', v8Version: 'saved-fixture', os: 'windows', architecture: 'x64', cpu: null },
    workload: { fingerprint: 'f'.repeat(64), inputShapeHash: null, phase: 'capture', description: 'offline saved fixture' },
    scope: { sessionId: 'session-fixture', processId: 'process-7', isolateId: 'isolate-1', workerId: null },
    clock: { domain: 'fixture-us', origin: null, unit: 'us', alignment: null }, collector: producer, parser: producer,
    actualFlags: [], instrumentation: { sampling: 'cpu', preciseCoverage: null, debugger: false, pauses: false,
      tracing: [], perturbation: ['saved data; collector overhead unknown'] }, startedAt: null, endedAt: null,
    limits: { durationMs: 100, maxSamples: 100, maxEvents: 100, maxBytes: 1024 * 1024,
      processTreeMemoryBytes: 16 * 1024 * 1024, diskReserveBytes: 16 * 1024 * 1024 },
    completion: 'complete', coverage: ['selected saved isolate only'], warnings: [], droppedEvents: null, rawArtifacts: [] };
  const inputs = [];
  const addRaw = async ({ name, bytes, format, formatVersion = '1' }) => {
    const filename = path.join(root, name);
    await fs.writeFile(filename, bytes);
    const artifact = { schemaVersion: 1, artifactId: name, captureId: capture.captureId,
      hash: runtimeByteHash(bytes), byteLength: bytes.length, format, formatVersion,
      mediaType: format === 'inspector-cpu-profile' ? 'application/json' : 'application/x-ndjson', parser: producer,
      retained: false, pinned: true, storageRef: null };
    capture.rawArtifacts.push(artifact); inputs.push({ artifactId: name, path: filename });
    return artifact;
  };
  for (const [name, format] of [['work.cpuprofile', 'inspector-cpu-profile'], ['code-log-v1.jsonl', 'pairofcleats-code-log']]) {
    await addRaw({ name, format, bytes: await fs.readFile(fileURLToPath(new URL('../fixtures/runtime/' + name, import.meta.url))) });
  }
  const options = () => ({ destination: path.join(root, 'import'), capture, inputs,
    importOptions: { maxDiskWorkingSetBytes: 16 * 1024 * 1024 },
    authority: { action: 'import-existing', captureId: capture.captureId, artifactHashes: capture.rawArtifacts.map(row => row.hash) },
    sourceCandidates: [{ sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
      targets: [{ partitionId: 'sy1:' + '1'.repeat(64), localId: 0 }] }] });
  const readRows = async result => (await fs.readFile(path.join(options().destination, 'generations', result.pointer.generationId, 'evidence.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { root, source, capture, inputs, addRaw, options, readRows, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
};
