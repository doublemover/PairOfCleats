import assert from 'node:assert/strict';
import { parse, resolve, render } from 'reladraw';
import { projectOutput, refKey, detectFamily } from '../../../src/map/workspace/projection.js';
import { authorProjection, quoteLabel } from '../../../src/map/workspace/reladraw.js';
import { applyDisplayLimits } from '../../../src/map/isometric/client/display-limits.js';
import { sourceFixture } from './source-fixture.js';
const fixture = sourceFixture();
const projection = projectOutput(fixture.result);
assert.equal(projection.family, 'semantic');
assert.equal(projection.nodes.length, fixture.result.records.length);
assert.ok(projection.edges.some(edge => edge.kind.startsWith('operand:')));
assert.equal(refKey({ partitionId: 'p', localId: 0 }), 'semantic:p:0');
for (const node of projection.nodes) assert.deepEqual(node.detail, fixture.result.records.find(record => refKey(record.ref) === node.id));
const story = authorProjection(projection); const layout = resolve(parse(story.source));
assert.equal(layout.nodes.length, projection.nodes.length); assert.ok(render(layout).startsWith('<svg'));
assert.equal(Object.keys(story.bindings).length, projection.nodes.length);
const hostile = 'one"\nnode injected "bad" / [markup] \\ 😀';
assert.equal(parse(`node safe ${quoteLabel(hostile)}`).statements.length, 1);
const map = { options: {}, nodes: [{path:'a.ts',members:[{id:0,name:'zero'},{id:1,name:'one'}]}, {path:'b.ts',members:[{id:2}]}],
  edges:[{type:'call',from:{file:'a.ts',member:0},to:{file:'a.ts',member:1}},{type:'import',from:{file:'a.ts'},to:{file:'b.ts'}}],
  edgeAggregates:[{type:'call',fromFile:'a.ts',toFile:'a.ts',count:1}], summary:{truncated:true,dropped:{files:999,members:10,edges:50}} };
const limited = applyDisplayLimits(map,{maxFiles:1,maxMembersPerFile:1,maxEdges:1}).map;
assert.equal(limited.summary.truncated,true); assert.equal(limited.summary.dropped.files,1000);
assert.equal(limited.summary.dropped.members,12); assert.equal(limited.summary.dropped.edges,52);
assert.equal(limited.coverage.display.dropped.edges,2); assert.equal(limited.edgeAggregates.length,0);
assert.equal(limited.coverage.source,map.summary);
const many = { options:{}, summary:{truncated:false}, nodes:Array.from({length:10000},(_,i)=>({path:`file${i}`,name:`File ${i}`,members:[]})),edges:[] };
const page = projectOutput(many,{page:49}); assert.equal(page.nodes.length,200); assert.equal(page.hasNext,false);
assert.equal(page.nodes[0].id,'file:file9800'); assert.equal(page.coverage.omittedEntities,9800);
assert.equal(projectOutput(many).nodes.length,200);
const graph = projectOutput({seed:{type:'file',path:'a'},nodes:[{ref:{type:'file',path:'a'}},{ref:{type:'file',path:'b'}}],edges:[
  {edgeType:'call',from:{type:'file',path:'b'},to:{type:'file',path:'a'}},
  {edgeType:'call',from:{type:'file',path:'a'},to:{status:'ambiguous',candidates:[{path:'b'}]}}
]});
assert.equal(graph.edges.length,1); assert.equal(graph.edges[0].from,'file:b');
assert.equal(graph.coverage.omittedRelations,1);
const search = projectOutput({code:[{id:'same',score:1,file:'a'},{id:'same',score:.8,file:'b'}]});
assert.equal(search.nodes.length,2); assert.equal(search.nodes[1].detail.originalRank,2);
for (const name of ['chunk_meta', 'symbols']) {
  const rows = [{ name: 'constructor', file: 'a.js' }, { name: 'constructor', file: 'b.js' }];
  const envelope = { kind: 'artifact-page', name, generation: 'build-one', ordinal: 200, rows };
  const projected = projectOutput(envelope);
  assert.equal(projected.nodes.length, 2, 'duplicate labels remain independently selectable');
  assert.notEqual(projected.nodes[0].id, projected.nodes[1].id);
  assert.deepEqual(projected.nodes.map(node => node.detail), rows);
  assert.deepEqual(projected.nodes.map(node => node.label), ['constructor', 'constructor']);
  assert.equal(projected.coverage.omittedEntities, 0);
  assert.notEqual(projectOutput({ ...envelope, ordinal: 202 }).nodes[0].id, projected.nodes[0].id);
  assert.notEqual(projectOutput({ ...envelope, generation: 'build-two' }).nodes[0].id, projected.nodes[0].id);
}
assert.equal(projectOutput({ kind: 'artifact-catalog', artifacts: [{ name: 'chunk_meta' }] }).nodes[0].id,
  'artifact:chunk_meta', 'catalog artifact identity remains the logical artifact name');
assert.equal(detectFamily({arbitrary:[]}), 'unknown');
for (const family of ['enrichment','runtime','risk','impact','architecture','tests','index','artifacts']) {
  const result = projectOutput({tasks:[],observations:[],flows:[],impacted:[],violations:[],suggestions:[],partitions:[],artifacts:[]},{family});
  assert.equal(result.family,family); assert.ok(result.sections.length > 0);
}
console.log('Source-derived semantic projection, Reladraw bindings, scope accounting, ranks, unresolved endpoints and 10k paged admission passed.');
const word = projectOutput({operation:'classify-compressed',cardinality:'one',complete:true,ref:{graphId:'published'},witnesses:{representation:'finite-string-word-dag-v1',location:'response-inline',graphEntry:{graphId:'response',graph:{rootIds:['concat'],nodes:[{id:'literal',kind:'Literal',value:'x'},{id:'concat',kind:'Concat',children:['literal','literal']}]}}}});
assert.equal(word.family,'symbolic');assert.equal(word.nodes.length,2);assert.equal(word.edges.length,2);assert.deepEqual(word.edges.map(e=>e.kind),['child:0','child:1']);
const roots = projectOutput({options:{},summary:{},nodes:Array.from({length:12},(_,i)=>({path:`group${i}`,name:`Group ${i}`,members:[]})),edges:[]});
assert.equal(resolve(parse(authorProjection(roots).source)).nodes.length,12);
assert.equal(parse(`node safe ${quoteLabel('x'.repeat(239)+'\\"')}`).statements.length,1);

// Shape comes directly from buildRiskDeltaPayload's public return contract.
const deltaBefore={flowId:'flow-1',confidence:0.4},deltaAfter={flowId:'flow-1',confidence:0.8};
const delta=projectOutput({version:1,from:{ref:'before'},to:{ref:'after'},summary:{flowCounts:{changed:1}},deltas:{flows:{added:[],removed:[],changed:[{flowId:'flow-1',before:deltaBefore,after:deltaAfter}],unchangedCount:0},partialFlows:{added:[],removed:[],changed:[],unchangedCount:0}}});
assert.equal(delta.family,'risk-delta');assert.equal(delta.nodes[0].kind,'changed');assert.strictEqual(delta.nodes[0].detail.before,deltaBefore);assert.strictEqual(delta.nodes[0].detail.after,deltaAfter);
