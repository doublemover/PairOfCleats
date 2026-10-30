import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createSemanticLspSession } from '../../../src/index/semantic/lsp-session.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-container-'));
try {
  const text = 'export function implementation(){return 1;} declare const remote:()=>number; remote(); remote(); remote(); remote(); remote();';
  const f = await createCompilerBoundaryFixture(root, { 'input.ts': text });
  const runtime = { root, buildRoot: root, semanticPolicy: f.policy };
  const session = await createSemanticLspSession({ state: f.state, runtime });
  const doc = session.prepareDocuments([])[0], uri = pathToFileURL(path.join(root, 'input.ts')).href;
  const targets = (await session.targetsForDocument(doc)).filter(target => target.name === 'remote' && target.invocation);
  assert.equal(targets.length, 5);
  const range = (start, end) => ({ start: { line: 0, character: start }, end: { line: 0, character: end } });
  const declaration = f.documents[0].sourceFile.statements[0];
  const selection = range(declaration.name.getStart(), declaration.name.end);
  const full = range(declaration.getStart(), declaration.end);
  const payloads = [
    { targetUri: uri, targetRange: full, targetSelectionRange: selection },
    { targetUri: uri, targetRange: range(0, selection.start.character), targetSelectionRange: selection },
    { targetUri: uri, targetRange: full },
    { targetUri: uri, targetRange: range(0, text.length + 1), targetSelectionRange: selection },
    { uri, range: selection }
  ];
  let index = 0;
  await session.collectDocument({ doc, uri, targets, requestDefinition: async () => ({ attempted: true, payload: [payloads[index++]] }) });
  assert.equal(index, 5);
  const output = session.output(), store = f.storeFor([...f.syntaxPartitions, ...output.partitions]);
  const records = [], edges = [], coverage = [];
  for (const partition of output.partitions) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  assert.deepEqual(records.filter(row => row.kind === 'binding').map(row => row.data.status),
    ['resolved', 'unresolved', 'unresolved', 'heuristic', 'resolved']);
  assert.equal(edges.filter(row => row.kind === 'callTarget' && row.certainty === 'exact-static').length, 2,
    'invalid or missing containing ranges cannot mint exact canonical call targets');
  assert.ok(records.filter(row => row.kind === 'externalDeclaration').every(row => row.data.sourceRange === null));
  assert.ok(coverage.every(row => row.state === 'partial'));
  const evidence = await Promise.all(f.state.semanticEvidenceArtifacts.map(async artifact => JSON.parse(
    await fs.readFile(path.join(f.stagingRoot, artifact.path), 'utf8'))));
  assert.equal(evidence.length, 5, 'invalid responses retain original protocol evidence without qualifying targets');
  assert.deepEqual(evidence[1].payload[0], payloads[1]);
  console.log('canonical LSP definition container join test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
