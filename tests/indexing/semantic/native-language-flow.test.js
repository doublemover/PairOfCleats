import assert from 'node:assert/strict';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { collectSemanticOwnership } from '../../../src/index/semantic/ownership.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

const programs = [
  ['python', 'main.py', 'def run(x):\n    while x:\n        if x == 2:\n            break\n        x = x - 1\n        continue\n    return x\n    dead()\n'],
  ['c', 'main.c', 'int run(int x) { while (x) { if (x == 2) break; x--; continue; } return x; dead(); }'],
  ['swift', 'main.swift', 'func run(_ x: Int) -> Int { while x > 0 { if x == 2 { break }; continue }; return x; dead() }'],
  ['rust', 'main.rs', 'fn run(mut x: i32) -> i32 { while x > 0 { if x == 2 { break; } x -= 1; continue; } return x; dead(); }']
];
for (const [language, relPath, text] of programs) {
  const fixture = await createRecoveryFixture(text);
  try {
    const policy = normalizeSemanticConfig({ enabled: true, languages: [language], enrichment: { localFlow: 'eager' }, storage: { batchRows: 9, batchBytes: 8192 } });
    const facts = await collectFileSemanticFacts({ ...fixture.options, bytes: fixture.bytes, text, language, relPath, repositoryNamespace: fixture.root, policy });
    assert.equal(facts.analysisPartitions.length, 1, language);
    const descriptor = await collectSemanticOwnership({ facts, chunks: [{ chunkUid: 'main', start: 0, end: text.length }], bytes: fixture.bytes,
      repositoryNamespace: fixture.root, stagingRoot: fixture.stagingRoot, storage: { generation: fixture.generation, relativePath: 'semantic' }, diskAccount: fixture.account, policy });
    assert.ok(descriptor.partitions.some(part => part.partitionId === facts.analysisPartitions[0].partitionId), 'ownership preserves derived native flow');
    const store = fixture.store(descriptor.partitions);
    await validateSemanticPartitions({ store, partitions: descriptor.partitions });
    const partition = facts.analysisPartitions[0], rows = [], edges = [];
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) rows.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    assert.ok(edges.some(edge => edge.kind === 'controlTrue'), language + ' conditional branch');
    assert.ok(edges.some(edge => edge.kind === 'controlFalse'), language + ' false continuation');
    assert.ok(edges.some(edge => edge.kind === 'returns'), language + ' explicit return');
    assert.ok(edges.every(edge => edge.certainty === 'modeled'), 'syntax-only flow never claims compiler/runtime precision');
    const blocks = new Map(rows.filter(row => row.kind === 'block').map(row => [row.id, row]));
    const entries = rows.filter(row => row.kind === 'block' && row.data.blockKind === 'entry');
    const seen = new Set(), pending = entries.map(row => row.id);
    while (pending.length) {
      const id = pending.pop(); if (seen.has(id)) continue; seen.add(id);
      for (const edge of edges) if (edge.from.partitionId === partition.partitionId && edge.from.localId === id
        && ['controlNext', 'controlTrue', 'controlFalse', 'exceptional'].includes(edge.kind)) pending.push(edge.to.localId);
    }
    assert.ok([...blocks.values()].filter(row => row.span && text.slice(...row.span).startsWith('dead(')).every(row => !seen.has(row.id)), 'return does not fall through to unreachable statements');
    const coverage = facts.coverage.find(row => row.phase === 'localFlow');
    assert.equal(coverage.state, 'partial'); assert.match(coverage.reason, /compiler_value_and_alias_flow_unavailable/);
  } finally { await fixture.cleanup(); }
}
console.log('Native structured control survives storage and ownership without false runtime precision');
