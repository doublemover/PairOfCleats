import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { emitCompilerTypeFacts } from '../../../src/index/semantic/compiler-type-facts.js';
import { createAnalysisPartitionId, createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { createSemanticPartitionSink } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createRecoveryFixture, semanticBatch, semanticNode } from '../../helpers/semantic-recovery.js';

// UNVALIDATED: actual checker -> emitted facts -> canonical partition and source store.
const text = 'const astral = 𝒜 => "first";\nconst bmp = π => "second";\nconst ascii = x => "third";\nfunction named(value: string): string { return value; }';
const fixture = await createRecoveryFixture(text);
try {
  const filename = path.join(fixture.root, 'facts.ts'); await fs.writeFile(filename, text);
  const program = ts.createProgram([filename], { noLib: true, target: ts.ScriptTarget.Latest, strict: false });
  const sourceFile = program.getSourceFile(filename); assert.ok(sourceFile); assert.equal(sourceFile.parseDiagnostics.length, 0);
  const snapshot = createSemanticSourceSnapshot({ bytes: fixture.bytes, repositoryNamespace: fixture.root,
    path: 'facts.ts', language: 'typescript' });
  const source = snapshot.manifest;
  const syntaxId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId,
    parser: { family: 'typescript', version: ts.version, options: { target: 'Latest', noLib: true } },
    extractor: { schemaVersion: 1, version: 'fixture' }, structuralPolicy: { structure: 'complete' } });
  const options = { ...fixture.options, source, sourceCapability: snapshot.sourceCapability, partitionId: syntaxId };
  const checker = program.getTypeChecker(), nodes = [], owners = new WeakMap();
  const walk = node => { owners.set(node, { partitionId: syntaxId, localId: nodes.length }); nodes.push(node); ts.forEachChild(node, walk); };
  walk(sourceFile);
  const syntaxSink = await createSemanticPartitionSink(options);
  await syntaxSink.appendBatch(semanticBatch(syntaxId, nodes.map((_node, id) => semanticNode(id, text.length))));
  const syntax = await syntaxSink.finalizeSource();
  const analysisId = createAnalysisPartitionId({ pass: { name: 'type-scalar-fixture', version: SEMANTIC_ANALYSIS_VERSIONS.compilerBindings },
    inputPartitionHashes: [syntax.canonicalHash], compilerContext: null, dependencySummaryHashes: [], analysisPolicy: {} });
  const ref = localId => ({ partitionId: analysisId, localId }), evidence = ref(0); let nextId = 1;
  const facts = await emitCompilerTypeFacts({ ts, checker, sourceFile, nodes,
    declarationFor: node => owners.get(node), expressionFor: node => owners.get(node),
    context: { contextKey: 'actual-typescript-scalar-fixture' }, ref, evidence, allocate: () => ref(nextId++) });
  assert.equal(facts.reasons.length, 0); assert.equal(facts.completedCount, facts.observedCount);
  const inferred = facts.rows.filter(entry => entry.family === 'node' && entry.row.data.origin === 'checker-inferred');
  for (const [parameter, width] of [['𝒜', 2], ['π', 1], ['x', 1]]) {
    const arrow = nodes.find(node => ts.isArrowFunction(node) && node.parameters[0].name.getText(sourceFile) === parameter);
    const fact = inferred.find(entry => entry.row.scope.localId === owners.get(arrow).localId);
    assert.ok(fact, parameter);
    assert.deepEqual(fact.row.span, [arrow.getStart(sourceFile), arrow.getStart(sourceFile) + width]);
    assert.deepEqual(fact.row.data.textRef.span, fact.row.span);
    assert.equal(text.slice(...fact.row.span), parameter);
  }
  const sink = await createSemanticPartitionSink({ ...options, partitionId: analysisId, structuralSlots: facts.structuralSlots });
  let nextEdge = 0;
  await sink.appendBatch(semanticBatch(analysisId, [{ family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null,
    data: { method: 'actual-typescript-fixture', producerId: 'typescript', producerVersion: ts.version,
      evidenceKind: 'static', sourceRef: source.sourceUnitId, artifactRef: null } } },
  ...facts.rows.map(entry => entry.family === 'edge' ? { ...entry, row: { ...entry.row, id: nextEdge++ } } : entry)]));
  const analysis = await sink.finalizeSource(), store = fixture.store([syntax, analysis]);
  const refs = inferred.map(entry => ref(entry.row.id));
  const stored = await store.getRecords(refs), spans = await store.getSourceSpans(refs);
  await store.verifySource(source, { spans: stored.map(row => row.span) });
  for (let index = 0; index < stored.length; index += 1) {
    assert.equal(spans[index].text, text.slice(...stored[index].span));
    assert.equal(spans[index].sourceHash, source.byteHash);
    assert.ok(!/^[\ud800-\udbff]$|^[\udc00-\udfff]$/u.test(spans[index].text), 'retained inference anchor is a complete scalar');
  }
} finally { await fixture.cleanup(); }
console.log('Compiler type-fact anchors preserve complete source scalars through canonical storage.');
