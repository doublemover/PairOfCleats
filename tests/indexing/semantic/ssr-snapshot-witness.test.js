import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPublishedSemanticWitness } from '../../helpers/published-semantic-witness.js';
import { createSemanticTraceParityBackends } from '../../helpers/compiler-trace-backends.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ssr-witness-'));
const key = canonicalSemanticJson;
const inspect = async fixture => {
  const parity = await createSemanticTraceParityBackends({ artifact: fixture.store, partitions: fixture.manifest.partitions,
    generation: fixture.manifest.generation, repoRoot: fixture.repoRoot });
  try {
    const source = [...fixture.sources.values()].find(row => row.path === 'host.ts');
    const text = await fs.readFile(path.join(fixture.repoRoot, source.path), 'utf8');
    const sourceRecords = fixture.records.filter(row => row.sourceUnitId === source.sourceUnitId && row.kind === 'expression' && row.span);
    const record = value => sourceRecords.find(row => text.slice(...row.span) === value);
    const first = record('10'), second = record('20'), firstCall = record('build(10)'), secondCall = record('build(20)');
    assert.ok(first && second && firstCall && secondCall);
    const forward = await parity.trace(first.ref);
    assert.ok(forward.records.some(row => key(row.ref) === key(firstCall.ref)));
    assert.ok(!forward.records.some(row => key(row.ref) === key(secondCall.ref)), 'two call sites never exchange numerical seeds');
    const snapshotSource = [...fixture.sources.values()].find(row => row.path === 'snapshot.ts');
    const snapshotText = await fs.readFile(path.join(fixture.repoRoot, snapshotSource.path), 'utf8');
    assert.ok(forward.records.some(row => row.data?.astKind === 'TemplateExpression' && row.ref
      && fixture.sourceFor(row.ref)?.sourceUnitId === snapshotSource.sourceUnitId
      && snapshotText.slice(...row.span).includes('<output>')), 'source-pinned modeled transport reaches the actual interpolation');
    const reverse = await parity.trace(secondCall.ref, 'upstream');
    assert.ok(reverse.records.some(row => key(row.ref) === key(second.ref)));
    assert.ok(!reverse.records.some(row => key(row.ref) === key(first.ref)));
    assert.ok(forward.edges.some(edge => edge.kind === 'copies'), 'snapshot state has explicit copy evidence');
    assert.ok(forward.records.some(row => row.kind === 'boundary' && row.data.boundaryKind === 'node-worker-message-consumer-candidate'), 'the supported MessageChannel family supplies the transport leg');
    return { records: forward.records.map(row => key(row.ref)).sort(), edges: forward.edges.map(key).sort() };
  } finally { parity.close(); }
};
try {
  const cold = await createPublishedSemanticWitness({ root });
  const expected = await inspect(cold);
  const warm = await createPublishedSemanticWitness({ root, incremental: true });
  assert.deepEqual(await inspect(warm), expected, 'cold and incremental publication retain the same qualified witness');
  console.log('Two invocation/snapshot/MessageChannel/interpolation witness has published artifact/SQLite parity');
} finally { await fs.rm(root, { recursive: true, force: true }); }
