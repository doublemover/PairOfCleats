import assert from 'node:assert/strict';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { compilerCallAdapter } from '../../../src/index/semantic/compiler-call-adapter.js';
import { compilerInvocationTargets, compilerRuntimeParameters } from '../../../src/index/semantic/compiler-invocation.js';
import { createCompilerDispatchResolver } from '../../../src/index/semantic/compiler-dispatch.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-call-adapter-'));
try {
  const fixture=await createCompilerBoundaryFixture(root,{'input.ts':`export {};
    function change(this:{field:number}, x:number, y:number){this.field=x;return y;}
    const box={field:0},other={field:9};
    change.call(box,1,2);change.apply(box,[3,4]);
    const bound=change.bind(box,5);bound(6);
    const rebound=bound.bind(other,7);rebound(8);bound.call(other,11);
    declare const values:number[];change.apply(box,values);
    const fake={call(receiver:any,value:number){return value;}};fake.call(box,10);
  `},{},{withFlow:true});
  const doc=fixture.documents[0],{ts,checker,expressionFor}=doc;
  const declarationRef=node=>{const anchor=node.name||node;return doc.item.declarations.get(anchor.getStart()+':'+anchor.end)||(ts.isFunctionLike(node)?expressionFor(node):null);};
  const dispatch=createCompilerDispatchResolver({ts,checker,nodes:doc.nodes,declarationRef});
  const callNodes=doc.nodes.filter(ts.isCallExpression),byText=new Map(callNodes.map(node=>[node.getText(),node]));
  const adapt=text=>compilerCallAdapter({ts,checker,node:byText.get(text),isDefaultLibrary:fixture.group.isDefaultLibrary});
  assert.deepEqual(adapt('change.call(box,1,2)').runtimeArguments.map(node=>node.getText()),['1','2']);
  assert.deepEqual(adapt('change.apply(box,[3,4])').runtimeArguments.map(node=>node.getText()),['3','4']);
  assert.deepEqual(adapt('bound(6)').runtimeArguments.map(node=>node.getText()),['5','6']);
  assert.deepEqual(adapt('rebound(8)').runtimeArguments.map(node=>node.getText()),['5','7','8']);
  assert.equal(adapt('rebound(8)').receiver.getText(),'box','rebinding cannot replace the first bound receiver');
  assert.equal(adapt('change.apply(box,values)').hasSpread,true,'unknown array-like positions cannot become exact parameter ordinals');
  assert.equal(adapt('fake.call(box,10)'),null,'matching user method names do not obtain intrinsic authority');
  const owner=doc.sourceFile.statements.find(node=>ts.isFunctionDeclaration(node));
  assert.deepEqual(compilerRuntimeParameters(ts,owner).map(node=>node.name.text),['x','y']);
  const calls=[];
  for(const node of callNodes) {
    const adapter=compilerCallAdapter({ts,checker,node,isDefaultLibrary:fixture.group.isDefaultLibrary});
    if(!adapter)continue;
    const resolved=compilerInvocationTargets({ts,checker,node,signature:checker.getResolvedSignature(node),declarationRef,targets:[],dispatch,adapter});
    assert.ok(resolved.targets.some(ref=>canonicalSemanticJson(ref)===canonicalSemanticJson(declarationRef(owner))));
    assert.equal(resolved.certainty,'modeled');assert.equal(resolved.parameterMappingAllowed,false);
    calls.push({occurrence:expressionFor(node),result:expressionFor(node),span:[node.getStart(),node.end],targets:resolved.targets,incompleteTargets:true,invocationKind:'call',receiver:expressionFor(adapter.receiver),arguments:adapter.runtimeArguments.map(expressionFor),unknownInputs:adapter.unknownInputs.map(expressionFor),hasSpread:adapter.hasSpread,reason:adapter.reasons.join(';')});
  }
  fixture.group.flowDocuments[0].calls=calls;
  const added=await collectCompilerCrossFileFlow(fixture),all=[...fixture.syntaxPartitions,...added],store=fixture.storeFor(all);
  await validateSemanticPartitions({store,partitions:all});
  const edges=[];for(const partition of added)for await(const edge of store.iterateRows(partition.partitionId,'semantic_edges'))edges.push(edge);
  const key=canonicalSemanticJson;
  const boundCall=calls.find(call=>key(call.occurrence)===key(expressionFor(byText.get('bound(6)'))));
  const parameter=declarationRef(owner.parameters[2]);
  assert.ok(edges.some(edge=>edge.kind==='argumentToParameter'&&key(edge.from)===key(boundCall.arguments[1])&&key(edge.to)===key(parameter)),'bound prefix and type-only this do not shift y');
  assert.ok(edges.some(edge=>edge.kind==='returnToResult'&&key(edge.callSite)===key(boundCall.occurrence)));
  const overridden=byText.get('bound.call(other,11)'),ignored=expressionFor(overridden.arguments[0]);
  assert.ok(edges.some(edge=>edge.kind==='flowsTo'&&key(edge.from)===key(ignored)&&key(edge.callSite)===key(expressionFor(overridden))),'unknown method replacement keeps ignored receiver operands');
  console.log('Checker-authorized call/apply/bind channels and runtime parameter positions passed');
} finally {await fs.rm(root,{recursive:true,force:true});}
