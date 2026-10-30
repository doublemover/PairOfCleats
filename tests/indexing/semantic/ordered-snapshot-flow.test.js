import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createCompilerTraceBackends } from '../../helpers/compiler-trace-backends.js';
import { collectCompilerValueSlice } from '../../../src/index/semantic/compiler-value-slice.js';
import { collectCompilerStorageFlow } from '../../../src/index/semantic/compiler-storage-flow.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ordered-snapshots-'));
let backends;
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'snapshots.ts': `export {};
    function objects(){const box={value:101};const before=box.value;const alias=box;alias.value=202;
      const snapshot={value:box.value};alias.value=303;const after=box.value;
      const separate={value:202};return [before,snapshot.value,after,separate.value];}
    function typed(){const buffer=new Uint8Array([11]);const alias=buffer;const before=alias.slice();
      alias[0]=22;const after=buffer.slice();alias[0]=33;const live=buffer.subarray();
      return [before[0],after[0],live[0]];}
    declare function leak(value:unknown):void;
    function escaped(){const buffer=new Uint8Array([41]);leak(buffer);buffer[0]=42;return buffer[0];}
    function dynamic(offset:number){const buffer=new Uint8Array([51]);const view=buffer.subarray(offset);return view[0];}
    function recovering(){const box={value:61};try{box.value=62;}catch{}return box.value;}
    function captured(){const buffer=new Uint8Array([71]);const read=()=>buffer[0];buffer[0]=72;return read();}
    function objectView(){const buffer=new Uint8Array([81]);const before=buffer.slice();
      const holder={view:buffer.subarray()};holder.view[0]=82;const after=buffer.slice();return [before[0],buffer[0],after[0]];}
    function arrayView(){const buffer=new Uint8Array([91]);const holder=[buffer.subarray()];holder[0][0]=92;return buffer[0];}
    function wrappedView(){const buffer=new Uint8Array([101,102]);
      const holder=[((buffer.subarray(1).subarray(0) as Uint8Array))];holder[0][0]=103;return buffer[1];}
    function sliceContainer(){const buffer=new Uint8Array([111]);const holder={copy:buffer.slice()};
      holder.copy[0]=112;return buffer[0];}
    function namedView(){const buffer=new Uint8Array([121]);const view=(buffer.subarray() as Uint8Array);
      view[0]=122;return buffer[0];}
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0], { ts, sourceFile, expressionFor } = doc;
  const added = [];
  const args = { ...doc, source: doc.item.source, root: fixture.stagingRoot, context: fixture.group.context,
    isDefaultLibrary: fixture.group.isDefaultLibrary, diskAccount: fixture.state.semanticDiskAccount };
  const slice = await collectCompilerValueSlice({ ...args, orderedOperations: flow.orderedOperations, orderedAccesses: flow.orderedAccesses });
  const storage = await collectCompilerStorageFlow({ ...args, orderedAccesses: flow.orderedAccesses });
  added.push(slice.partition, storage.partition, ...await collectCompilerCrossFileFlow(fixture));
  backends = await createCompilerTraceBackends(fixture, [...fixture.syntaxPartitions, ...added]);
  const owner = name => sourceFile.statements.find(node => node.name?.text === name);
  const inside = (name, predicate) => doc.nodes.filter(node => node.getStart(sourceFile) >= owner(name).getStart(sourceFile)
    && node.end <= owner(name).end && predicate(node));
  const literal = (name, value, index = 0) => expressionFor(inside(name, node => ts.isNumericLiteral(node) && node.text === String(value))[index]);
  const expression = (name, text, index = 0) => expressionFor(inside(name, node => node.getText(sourceFile) === text)[index]);
  const reaches = async (seed, target) => (await backends.trace(seed)).records.some(row => canonicalSemanticJson(row.ref) === canonicalSemanticJson(target));
  assert.ok(await reaches(literal('objects', 101), expression('objects', 'box.value')), 'initial field reaches read-before-write');
  assert.ok(!await reaches(literal('objects', 202, 0), expression('objects', 'box.value', 0)), 'later mutation never reaches the earlier read');
  assert.ok(await reaches(literal('objects', 202, 0), expression('objects', 'snapshot.value')));
  assert.ok(!await reaches(literal('objects', 101), expression('objects', 'snapshot.value')), 'overwritten field is absent from captured snapshot');
  assert.ok(!await reaches(literal('objects', 303), expression('objects', 'snapshot.value')), 'post-snapshot mutation is absent from copied value');
  assert.ok(!await reaches(literal('objects', 202, 1), expression('objects', 'snapshot.value')), 'equal-looking separate allocations stay distinct');
  assert.ok(await reaches(literal('objects', 303), expression('objects', 'box.value', 2)));
  for (const [value, target] of [[11, 'before[0]'], [22, 'after[0]'], [33, 'live[0]']]) assert.ok(await reaches(literal('typed', value), expression('typed', target)), target);
  for (const [value, target] of [[22, 'before[0]'], [33, 'before[0]'], [11, 'after[0]'], [33, 'after[0]'], [11, 'live[0]'], [22, 'live[0]']]) {
    assert.ok(!await reaches(literal('typed', value), expression('typed', target)), value + ' cannot cross the captured state for ' + target);
  }
  const dynamic = inside('dynamic', ts.isCallExpression)[0];
  assert.ok(!flow.orderedOperations.has(canonicalSemanticJson(expressionFor(dynamic))), 'dynamic offset remains outside the precise subset');
  assert.ok(await reaches(literal('escaped', 41), expression('escaped', 'buffer[0]', 1)), 'escape retains older may-alternatives');
  assert.ok(!flow.orderedAccesses.has(canonicalSemanticJson(expression('recovering', 'box.value', 0))), 'recovering exceptional paths retain conservative state');
  assert.ok(!flow.orderedAccesses.has(canonicalSemanticJson(expression('captured', 'buffer[0]', 1))), 'owner-local indexing retains nested capture escapes');
  for (const [name, target] of [['objectView', 'buffer[0]'], ['arrayView', 'buffer[0]'], ['wrappedView', 'buffer[1]']]) {
    assert.equal(flow.orderedAccesses.has(canonicalSemanticJson(expression(name, target))), false,
      `${name}: a fresh container-held view revokes ordered backing-root eligibility`);
  }
  assert.ok(flow.orderedAccesses.has(canonicalSemanticJson(expression('sliceContainer', 'buffer[0]'))),
    'an escaped independent slice copy cannot revoke its source allocation');
  assert.ok(flow.orderedAccesses.has(canonicalSemanticJson(expression('namedView', 'buffer[0]'))),
    'wrapped direct const aliases remain in the supported ordered subset');
  assert.ok(await reaches(literal('namedView', 122), expression('namedView', 'buffer[0]')));
  assert.ok(await reaches(literal('objectView', 81), expression('objectView', 'before[0]')));
  assert.ok(!await reaches(literal('objectView', 82), expression('objectView', 'before[0]')),
    'a snapshot before escape retains its independent history');
  assert.equal(flow.orderedOperations.has(canonicalSemanticJson(expression('objectView', 'buffer.slice()', 1))), false,
    'a snapshot after an unknown shared write cannot claim exact historical contents');
  const coverage = await backends.artifact.getCoverage([flow.partition.partitionId]);
  assert.deepEqual(await backends.sqlite.getCoverage([flow.partition.partitionId]), coverage);
  assert.ok(coverage.some(row => row.state === 'partial' && row.reason.includes('ordered_storage_alias_escape_unresolved')),
    'unsupported container aliases publish an explicit incomplete boundary rather than a closed negative');
  await backends.trace(literal('arrayView', 92));
  await backends.trace(literal('wrappedView', 103));
  const counts = { records: 0, edges: 0 };
  for (const partition of [...fixture.syntaxPartitions, ...added]) {
    for await (const _row of backends.artifact.iterateRows(partition.partitionId, 'semantic_records')) counts.records += 1;
    for await (const _row of backends.artifact.iterateRows(partition.partitionId, 'semantic_edges')) counts.edges += 1;
  }
  assert.ok(counts.records < 10000 && counts.edges < 10000, 'fixed-fidelity tiny witness has bounded retained facts');
  console.log('Ordered literal fields, typed copies/views and escape frontiers preserve combined producer parity', counts);
} finally { backends?.close(); await fs.rm(root, { recursive: true, force: true }); }
