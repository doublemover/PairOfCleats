import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createCompilerTraceBackends } from '../../helpers/compiler-trace-backends.js';
import { collectCompilerValueSlice } from '../../../src/index/semantic/compiler-value-slice.js';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-operation-inputs-'));
let backends;
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'values.tsx': [
    'function direct(x:number){return x;}',
    'function parens(x:number){return (x);}',
    'function asserted(x:number){return x as number;}',
    'function nonnull(x:number){return x!;}',
    'function satisfies(x:number){return x satisfies number;}',
    'function template(x:number){return `prefix ${x} suffix`;}',
    'function unused(x:number,y:number){return x;}',
    'function textOnly(x:number){return `literal x`;}',
    'function unknown(x:number){return <span>{x}</span>;}'
  ].join('\n') }, {}, { withFlow: true });
  const document = fixture.group.flowDocuments[0], summaries = buildCallDependencySummaries([document]);
  const names = ['direct', 'parens', 'asserted', 'nonnull', 'satisfies', 'template'];
  for (const name of names) {
    const owner = document.summaries.find(row => row.owner.name?.text === name);
    assert.deepEqual([...summaries.functions.get(canonicalSemanticJson(owner.declaration)).dependencies], [0], name + ' retains its runtime input');
  }
  const unused = document.summaries.find(row => row.owner.name?.text === 'unused');
  assert.deepEqual([...summaries.functions.get(canonicalSemanticJson(unused.declaration)).dependencies], [0]);
  const textOnly = document.summaries.find(row => row.owner.name?.text === 'textOnly');
  assert.equal(summaries.functions.get(canonicalSemanticJson(textOnly.declaration)).dependencies.size, 0, 'literal text never refers to a parameter');
  const template = document.summaries.find(row => row.owner.name?.text === 'template');
  assert.ok(template.exceptions.length > 0, 'template coercion retains an exceptional frontier');
  assert.equal(template.complete, false, 'coercion uncertainty cannot claim complete value semantics');
  const unknown = document.summaries.find(row => row.owner.name?.text === 'unknown');
  assert.equal(unknown.complete, false, 'an unsupported JSX value is not a complete empty summary');
  const doc = fixture.documents[0];
  const slice = await collectCompilerValueSlice({ ...doc, source: doc.item.source, root: fixture.stagingRoot,
    context: fixture.group.context, isDefaultLibrary: fixture.group.isDefaultLibrary, diskAccount: fixture.state.semanticDiskAccount });
  const partitions = [...fixture.syntaxPartitions, slice.partition];
  backends = await createCompilerTraceBackends(fixture, partitions);
  for (const name of names) {
    const owner = document.summaries.find(row => row.owner.name?.text === name);
    const trace = await backends.trace(owner.parameters[0]);
    assert.ok(trace.records.some(row => canonicalSemanticJson(row.ref) === canonicalSemanticJson(owner.returns[0])), name + ' reaches its actual return');
    const reverse = await backends.trace(owner.returns[0], 'upstream');
    assert.ok(reverse.records.some(row => canonicalSemanticJson(row.ref) === canonicalSemanticJson(owner.parameters[0])));
  }
  const absent = await backends.trace(unused.parameters[1]);
  assert.ok(!absent.records.some(row => canonicalSemanticJson(row.ref) === canonicalSemanticJson(unused.returns[0])));
  const values = [];
  for await (const row of backends.artifact.iterateRows(slice.partition.partitionId, 'semantic_records')) values.push(row);
  assert.ok(values.some(row => row.kind === 'value' && row.data.origin === 'unknown'), 'unsupported operations publish an explicit unknown value');
  console.log('Shared runtime-operation dependencies retain wrappers/interpolation with drained backend parity');
} finally { backends?.close(); await fs.rm(root, { recursive: true, force: true }); }
