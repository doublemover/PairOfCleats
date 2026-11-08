import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPublishedSemanticWitness } from './published-semantic-witness.js';
import { createSemanticTraceParityBackends, drainSemanticTrace } from './compiler-trace-backends.js';
import { canonicalSemanticJson } from '../../src/index/semantic/identity.js';

const key = canonicalSemanticJson;

export const createSsrWitness = (root, incremental = false) => createPublishedSemanticWitness({ root, incremental,
  // Both metadata files remain present compiler dependencies, not indexed
  // source witnesses. These Node-only inputs do not use browser DOM globals.
  threads: 1, extraIgnore: ['tsconfig.json', 'package.json'], compilerOptions: { lib: ['es2022'] },
  recordPartitionFilter: partition => partition.partitionId.startsWith('sy1:') });

export const inspectSsrWitness = async (fixture, { backendParity = true, forwardOnly = false } = {}) => {
  const limits = { records: 128, edges: 128, bytes: 65536, depth: 64 };
  const parity = backendParity ? await createSemanticTraceParityBackends({ artifact: fixture.store,
    partitions: fixture.manifest.partitions, generation: fixture.manifest.generation,
    repoRoot: fixture.repoRoot, limits }) : null;
  try {
    const trace = backendParity ? parity.trace : (seed, direction) => drainSemanticTrace({ store: fixture.store,
      repoRoot: fixture.repoRoot, generation: fixture.manifest.generation, seed, direction, limits });
    const source = [...fixture.sources.values()].find(row => row.path === 'host.ts');
    const text = await fs.readFile(path.join(fixture.repoRoot, source.path), 'utf8');
    const sourceRecords = fixture.records.filter(row => row.sourceUnitId === source.sourceUnitId && row.kind === 'expression' && row.span);
    const record = value => sourceRecords.find(row => text.slice(...row.span) === value);
    const first = record('10'), second = record('20'), firstCall = record('build(10)'), secondCall = record('build(20)');
    assert.ok(first && second && firstCall && secondCall);
    const forward = await trace(first.ref);
    assert.ok(forward.records.some(row => key(row.ref) === key(firstCall.ref)));
    assert.ok(!forward.records.some(row => key(row.ref) === key(secondCall.ref)), 'two call sites never exchange numerical seeds');
    const snapshotSource = [...fixture.sources.values()].find(row => row.path === 'snapshot.ts');
    const snapshotText = await fs.readFile(path.join(fixture.repoRoot, snapshotSource.path), 'utf8');
    assert.ok(forward.records.some(row => row.data?.astKind === 'TemplateExpression' && row.ref
      && fixture.sourceFor(row.ref)?.sourceUnitId === snapshotSource.sourceUnitId
      && snapshotText.slice(...row.span).includes('<output>')), 'source-pinned modeled transport reaches the actual interpolation');
    if (!forwardOnly) {
      const reverse = await trace(secondCall.ref, 'upstream');
      assert.ok(reverse.records.some(row => key(row.ref) === key(second.ref)));
      assert.ok(!reverse.records.some(row => key(row.ref) === key(first.ref)));
    }
    assert.ok(forward.edges.some(edge => edge.kind === 'copies'), 'snapshot state has explicit copy evidence');
    assert.ok(forward.records.some(row => row.kind === 'boundary' && row.data.boundaryKind === 'node-worker-message-consumer-candidate'), 'the supported MessageChannel family supplies the transport leg');
    return { records: forward.records.map(row => key(row.ref)).sort(), edges: forward.edges.map(key).sort() };
  } finally { parity?.close(); }
};
