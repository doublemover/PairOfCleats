import assert from 'node:assert/strict';
import { resolvePublishedSemanticCoverage } from '../../../src/semantic/coverage-resolution.js';

const generation={baseBuildId:'saved',semanticRevision:0};
const deferred={partitionId:'old',scope:{sourceUnitId:'source'},phase:'localFlow',state:'deferred',frontierRef:'task'};
const partial={partitionId:'new',scope:{sourceUnitId:'source'},phase:'localFlow',state:'partial',frontierRef:'remaining'};
const options={generation,completedTasks:[{baseBuildId:'saved',taskId:'task'}],sourceForPartition:()=>null};
assert.deepEqual(resolvePublishedSemanticCoverage([deferred,partial],options),[partial],'actual partial coverage survives a resolved deferred marker');
assert.deepEqual(resolvePublishedSemanticCoverage([deferred],options),[deferred],'receipt without actual phase output cannot hide pending coverage');
assert.deepEqual(resolvePublishedSemanticCoverage([deferred,partial],{...options,completedTasks:[{baseBuildId:'other',taskId:'task'}]}),[deferred,partial],'receipt cannot cross generations');
assert.deepEqual(resolvePublishedSemanticCoverage([deferred,{...partial,scope:{sourceUnitId:'other'}}],options),[deferred,{...partial,scope:{sourceUnitId:'other'}}],'output for another source cannot resolve this frontier');
assert.deepEqual(resolvePublishedSemanticCoverage([deferred,{...partial,phase:'bindings'}],options),[deferred,{...partial,phase:'bindings'}],'output for another phase cannot resolve this frontier');
console.log('completed semantic coverage checks passed');
