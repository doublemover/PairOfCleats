import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createSemanticCompilerSession } from '../../../src/index/semantic/compiler-session.js';
import { createSemanticLspSession } from '../../../src/index/semantic/lsp-session.js';
import { createTypeScriptNodeIndex } from '../../../src/index/tooling/typescript/node-index.js';
import { mergeSemanticProviderOutput } from '../../../src/index/semantic/merge-provider.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-provider-import-'));
try {
  const text = 'import { implementation as alias } from "./implementation"; declare const remote:(value:number)=>number; remote(5);';
  const f = await createCompilerBoundaryFixture(root, { 'input.ts': text, 'implementation.ts': 'export function implementation(value:number){return value;}' });
  const runtime = { root, buildRoot: root, semanticPolicy: f.policy };
  const lsp = await createSemanticLspSession({ state: f.state, runtime });
  const document = lsp.prepareDocuments([]).find(doc => doc.virtualPath === 'input.ts');
  const target = (await lsp.targetsForDocument(document)).find(value => value.name === 'remote' && value.invocation);
  assert.ok(target);
  const compiler = await createSemanticCompilerSession({ state: f.state, runtime });
  const ts = f.documents[0].ts;
  const options = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, types: [], skipLibCheck: true };
  const program = ts.createProgram(f.documents.map(doc => doc.sourceFile.fileName), options), checker = program.getTypeChecker();
  const group = compiler.beginGroup({ ts, program, options, documents: compiler.prepareDocuments([]) });
  for (const doc of f.documents) {
    const sourceFile = program.getSourceFile(doc.sourceFile.fileName);
    await compiler.collectDocument({ ts, checker, sourceFile, nodeIndex: createTypeScriptNodeIndex(ts, sourceFile, () => null), group });
  }
  assert.equal(group.flowDocuments.length, 2);
  assert.ok(group.flowDocuments.every(doc => doc.bindingPartition), 'production retains compiler alias provenance');
  const uri = pathToFileURL(path.join(root, 'input.ts')).href, start = text.indexOf('alias');
  await lsp.collectDocument({ doc: document, uri, targets: [target], requestDefinition: async () => ({ attempted: true, payload: [{ uri, range: { start: { line: 0, character: start }, end: { line: 0, character: start + 5 } } }] }) });
  const output = lsp.output();
  await mergeSemanticProviderOutput({ output, state: f.state, runtime });
  await compiler.finishGroup(group);
  const before = compiler.output().partitions.length;
  await compiler.joinProviderOutput(output);
  const joined = compiler.output().partitions.slice(before);
  assert.equal(joined.length, 2);
  const store = f.storeFor(joined), edges = [], coverage = [];
  for (const partition of joined) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  assert.ok(edges.some(edge => edge.kind === 'returnToResult' && edge.callSite.partitionId === target.invocation.ref.partitionId && edge.callSite.localId === target.invocation.ref.localId));
  assert.ok(coverage.some(row => row.reason?.includes('provider_call_target_candidates') && row.reason.includes('unknown_call_return_remainder')));
  console.log('LSP definition to checker import alias joins retained cross-file source summary');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
