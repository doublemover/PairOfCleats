import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { createSemanticLspSession } from '../../../src/index/semantic/lsp-session.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { exactLspRange } from '../../../src/index/semantic/lsp-locations.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
const text = 'function foo() { return 1; }\r\nfoo(); foo(); foo(); foo(); foo(); // é😀';
const fixture = await createRecoveryFixture(text);
try {
  const policy = normalizeSemanticConfig({ enabled: true, languages: ['javascript','typescript'], storage: { batchRows: 17, batchBytes: 8192 }, enrichment: { bindings: 'eager' } });
  const facts = await collectFileSemanticFacts({ ...fixture.options, bytes: fixture.bytes, text, ast: parseJavaScriptAst(text), language: 'javascript', relPath: 'original.js', repositoryNamespace: fixture.root, policy });
  const descriptor = createSemanticFactsRef({ source: facts.source, partitions: [facts.partition], syntaxPartitionId: facts.partition.partitionId, storage: { generation: fixture.generation, relativePath: 'semantic' }, coverage: facts.coverage });
  const state = { semanticFactsByFile: new Map([['original.js',descriptor]]), semanticDiskAccount: fixture.account };
  const session = await createSemanticLspSession({ state, runtime: { root: fixture.root, buildRoot: fixture.root, semanticPolicy: policy } });
  assert.ok(session.hasTargetedWork);
  const doc = session.prepareDocuments([])[0];
  await assert.rejects(session.targetsForDocument({ ...doc, text: text + ' ' }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  const trace = path.join(fixture.root,'lsp-trace.jsonl'); process.env.POC_SEMANTIC_LSP_TRACE = trace;
  const output = await collectLspTypes({ rootDir: fixture.root, vfsRoot: fixture.root, documents: [doc], targets: [],
    cmd: process.execPath, args: [path.resolve('tests/fixtures/lsp/semantic-location-server.js')], providerId: 'semantic-fixture', providerVersion: '1', semanticSession: session,
    parseSignature: () => ({ returnType: 'number', paramTypes: [], paramNames: [] }), timeoutMs: 5000, retries: 0, sessionPoolingEnabled: false, vfsColdStartCache: false, semanticTokensEnabled: false, signatureHelpEnabled: false, typeDefinitionEnabled: false, referencesEnabled: false, inlayHintsEnabled: false });
  delete process.env.POC_SEMANTIC_LSP_TRACE;
  assert.equal(output.semanticFacts.partitions.length, 2,
    'definition bindings and structured response observations retain separate partitions');
  const requests = (await fs.readFile(trace,'utf8')).trim().split('\n').map(JSON.parse); assert.equal(requests.length, 5, 'definition admission targets unresolved occurrences even when source signature is complete'); assert.equal(new Set(requests.map(value=>JSON.stringify(value.position))).size, 5);
  const store = createArtifactSemanticStore({ root: fixture.stagingRoot, repoRoot: fixture.root, generation: fixture.generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, partitions: [facts.partition,...output.semanticFacts.partitions] });
  const derived = [];
  for (const partition of output.semanticFacts.partitions) {
    const rows = [], edges = [];
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) rows.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    derived.push({ partition, rows, edges });
  }
  const bindingPartitions = derived.filter(value => value.rows.some(row => row.kind === 'binding'));
  assert.equal(bindingPartitions.length, 1);
  const { partition: bindingPartition, rows, edges } = bindingPartitions[0];
  const structured = derived.filter(value => value !== bindingPartitions[0]);
  assert.equal(structured.length, 1);
  assert.ok(structured[0].rows.length > 0);
  assert.ok(structured[0].rows.every(row => row.kind === 'evidence'
    && row.data.evidenceKind === 'lsp-structured-observation'));
  assert.deepEqual(rows.filter(row=>row.kind==='binding').map(row=>row.data.status), ['resolved','ambiguous','heuristic','unresolved','unresolved']);
  assert.ok(rows.filter(row=>row.kind==='binding').every(row=>row.data.signature === null)); assert.ok(edges.some(row=>row.certainty==='exact-static')); assert.ok(edges.some(row=>row.certainty==='modeled'));
  assert.ok(rows.filter(row=>row.kind==='externalDeclaration').every(row=>row.data.sourceRange === null && row.data.sourceHash === null));
  assert.equal(rows.filter(row=>row.kind==='evidence').length, 5);
  for(const record of state.semanticEvidenceArtifacts) { const bytes=await fs.readFile(path.join(fixture.stagingRoot,record.path)); assert.equal(bytes.length,record.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'),record.hash); }
  const links = await Promise.all(state.semanticEvidenceArtifacts.map(async record=>JSON.parse(await fs.readFile(path.join(fixture.stagingRoot,record.path),'utf8'))));
  assert.ok(links.some(value=>value.payload?.[0]?.targetSelectionRange && value.payload[0].originSelectionRange)); assert.ok(links.some(value=>value.error?.message));
  const coverage=[]; for await(const row of store.iterateRows(bindingPartition.partitionId,'semantic_coverage')) coverage.push(row); assert.equal(coverage[0].state,'failed');
  assert.equal(exactLspRange(facts.source,text,{start:{line:999,character:0},end:{line:999,character:1}}),null);
  const unsupported = await createSemanticLspSession({state,runtime:{root:fixture.root,buildRoot:fixture.root,semanticPolicy:policy}}); await unsupported.collectDocument({doc,uri:'file:///unsupported.js',definitionEnabled:false,requestDefinition:()=>assert.fail('unsupported must not request')}); const unavailable=fixture.store([facts.partition,...unsupported.output().partitions]); const states=[];for await(const row of unavailable.iterateRows(unsupported.output().partitions[0].partitionId,'semantic_coverage')) states.push(row.state); assert.deepEqual(states,['unsupported']);
  console.log('Semantic LSP Location/LocationLink evidence passed');
} finally { delete process.env.POC_SEMANTIC_LSP_TRACE; await fixture.cleanup(); }
