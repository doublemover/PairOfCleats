import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createSemanticLspSession } from '../../../src/index/semantic/lsp-session.js';
import { offsetToLspPosition } from '../../../src/index/semantic/lsp-locations.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only: actual retained source/occurrence/definition/evidence owners.
// Controlled asynchronous callbacks return data; no LSP server or source runs.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-owned-handoff-'));
try {
  const text = 'export function implementation(value:number){return value;} export function decoy(value:number){return value+1;} declare const remote:(value:number)=>number; remote(1); remote(2);';
  const fixture = await createCompilerBoundaryFixture(root, { 'input.ts': text });
  const doc = fixture.documents[0], runtime = { root, buildRoot: root, semanticPolicy: fixture.policy };
  const session = await createSemanticLspSession({ state: fixture.state, runtime });
  const document = session.prepareDocuments([])[0], uri = pathToFileURL(path.join(root, 'input.ts')).href;
  const selected = (await session.targetsForDocument(document)).filter(target => target.name === 'remote' && target.invocation);
  assert.equal(selected.length, 2);
  const clone = value => JSON.parse(JSON.stringify(value));
  let requested = 0;
  const unused = async () => { requested++; throw new Error('An invalid target must fail before provider acquisition.'); };
  const changed = update => { const target = clone(selected[0]); update(target); return [target]; };
  const invalid = [
    changed(target => { target.name = 'decoy'; }),
    changed(target => { target.span[1] += 1; }),
    changed(target => { target.roles = ['write']; }),
    changed(target => { target.invocation = clone(selected[1].invocation); }),
    changed(target => { target.ref = clone(target.invocation.ref); }),
    changed(target => { target.ref.partitionId = 'sy1:' + 'f'.repeat(64); }),
    [clone(selected[0]), clone(selected[0])]
  ];
  for (const targets of invalid) await assert.rejects(session.collectDocument({ doc: document, uri, targets,
    requestDefinition: unused }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  let targetGetters = 0;
  const accessor = clone(selected[0]);
  Object.defineProperty(accessor, 'name', { enumerable: true, get() { targetGetters++; return 'remote'; } });
  await assert.rejects(session.collectDocument({ doc: document, uri, targets: [accessor], requestDefinition: unused }), TypeError);
  await assert.rejects(session.collectDocument({ doc: document, uri, targets: new Array(1), requestDefinition: unused }), TypeError);
  assert.equal(targetGetters, 0);
  assert.equal(requested, 0);
  assert.deepEqual(session.output().partitions, []);
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 0, 'target admission failure publishes no evidence or completed document');

  let responseGetters = 0;
  const accessorResponse = { attempted: true };
  Object.defineProperty(accessorResponse, 'payload', { enumerable: true, get() { responseGetters++; return null; } });
  await assert.rejects(session.collectDocument({ doc: document, uri, targets: [clone(selected[0])],
    requestDefinition: async () => accessorResponse }), TypeError);
  assert.equal(responseGetters, 0);
  assert.deepEqual(session.output().partitions, []);
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 0);

  const declarationRange = node => ({ start: offsetToLspPosition(doc.item.source, text, node.name.getStart(doc.sourceFile), 'utf-16'),
    end: offsetToLspPosition(doc.item.source, text, node.name.end, 'utf-16') });
  const implementation = doc.sourceFile.statements[0], decoy = doc.sourceFile.statements[1];
  const range = declarationRange(implementation), decoyRange = declarationRange(decoy);
  const provided = clone(selected), expected = clone(provided), responses = [];
  let calls = 0;
  await session.collectDocument({ doc: document, uri, targets: provided, requestDefinition: async (symbol, position) => {
    assert.equal(symbol.name, 'remote');
    assert.deepEqual(position, offsetToLspPosition(doc.item.source, text, expected[calls].span[0], 'utf-16'));
    position.line = 0; position.character = 0;
    if (calls === 0) {
      provided[0].ref.localId = provided[1].ref.localId;
      provided[0].span[0] = 0;
      provided[0].invocation = clone(provided[1].invocation);
      provided.reverse();
    } else {
      responses[0].payload[0].uri = 'file:///wrong-origin.ts';
      responses[0].payload[0].range = decoyRange;
    }
    calls++;
    const response = { attempted: true, payload: [{ uri, range: clone(range) }] };
    responses.push(response);
    return response;
  } });
  assert.equal(calls, 2);
  const output = session.output(), partitions = [...fixture.syntaxPartitions, ...output.partitions], store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const bindings = [], edges = [];
  for (const partition of output.partitions) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) if (row.kind === 'binding') bindings.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) if (row.kind === 'callTarget') edges.push(row);
  }
  assert.deepEqual(bindings.map(row => row.span), expected.map(target => target.span));
  assert.deepEqual(bindings.map(row => row.data.occurrence), expected.map(target => target.ref));
  assert.ok(bindings.every(row => row.data.status === 'resolved'));
  assert.deepEqual(edges.map(edge => edge.callSite), expected.map(target => target.invocation.ref));
  assert.deepEqual(edges[0].to, edges[1].to, 'later mutation of the first response cannot retarget its accepted declaration');
  const evidence = await Promise.all(fixture.state.semanticEvidenceArtifacts.map(async artifact => JSON.parse(
    await fs.readFile(path.join(fixture.stagingRoot, artifact.path), 'utf8'))));
  assert.equal(evidence.length, 2);
  for (let index = 0; index < evidence.length; index++) {
    assert.deepEqual(evidence[index].position, offsetToLspPosition(doc.item.source, text, expected[index].span[0], 'utf-16'));
    assert.equal(evidence[index].payload[0].uri, uri);
    assert.deepEqual(evidence[index].payload[0].range, range);
  }
  console.log('LSP handoff pins canonical target selections, callback positions and response evidence');
} finally { await fs.rm(root, { recursive: true, force: true }); }
