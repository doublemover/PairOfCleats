import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCompilerBoundaryFixture} from '../../helpers/compiler-boundary-fixture.js';
import {createCompilerDispatchResolver} from '../../../src/index/semantic/compiler-dispatch.js';
import {compilerInvocationInputs,compilerInvocationTargets} from '../../../src/index/semantic/compiler-invocation.js';
import {collectCompilerCrossFileFlow} from '../../../src/index/semantic/compiler-cross-file-flow.js';
import {validateSemanticPartitions} from '../../../src/index/semantic/reconcile.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-dispatch-'));
try {
  const fixture=await createCompilerBoundaryFixture(root,{'dispatch.ts':`export {};
    function first(x:number,y:number){return x;}function second(x:number,y:number){return y;}
    function alternatives(flag:boolean,a:number,b:number){const selected=flag?first:second;return selected(a,b);}
    class Base {run(x:number){return x+1;} inherited(x:number){return x;}}
    class Derived extends Base {run(x:number){return x+2;}}
    function replacement(x:number){return x+3;}Derived.prototype.run=replacement;
    const object:Base=new Derived();const changed=object.run(4);const inherited=object.inherited(5);
    const literal={run:(x:number)=>x+6};literal.run(7);
    function heap(key:string,flag:boolean,input:number){const left={value:1};const right={value:2};let alias=left;if(flag)alias=right;alias[key]=input;return left.value;}
    function finite(key:'a'|'b',input:number){const object={a:1,b:2};object[key]=input;return object.a;}
    function implicit(flag:boolean){if(flag)return 1;}function bare(){return;}
    function overridden(){try{return 1;}finally{return 2;}}
    class Box {value=0;set(input:number){this.value=input;}get callback(){return first;}}
    function receiver(input:number){const box=new Box();box.set(input);return box.value;}
    const accessor=new Box();accessor.callback(8,9);
    class StaticBase {static method(x:number){return x;}}
    class StaticChild extends StaticBase {static call(x:number){return this.method(x);}}
    function reassigned(x:number,y:number){return x;}reassigned=second;reassigned(10,11);
    function rest(...values:number[]){return values[1];}function restCaller(a:number,b:number){return rest(a,b);}

  `},{},{withFlow:true});
  const doc=fixture.documents[0],{ts,checker,sourceFile,expressionFor}=doc;
  const declarationRef=node=>{const anchor=node.name||node;return doc.item.declarations.get(anchor.getStart(sourceFile)+':'+anchor.end)|| (ts.isFunctionLike(node)?expressionFor(node):null);};
  const dispatch=createCompilerDispatchResolver({ts,checker,nodes:doc.nodes,declarationRef});
  const calls=[];
  for(const node of doc.nodes) if(ts.isCallExpression(node)) {
    const symbol=checker.getSymbolAtLocation(node.expression),targets=(symbol?.declarations||[]).map(declarationRef).filter(Boolean);
    const selected=compilerInvocationTargets({ts,checker,node,signature:checker.getResolvedSignature(node),declarationRef,targets,dispatch});
    calls.push({...selected,node,occurrence:expressionFor(node),span:[node.getStart(sourceFile),node.end],incompleteTargets:selected.incomplete,invocationKind:'call',arguments:compilerInvocationInputs(ts,node).runtimeArguments.map(expressionFor),result:expressionFor(node),hasSpread:false,receiver:ts.isPropertyAccessExpression(node.expression)?expressionFor(node.expression.expression):null});
  }
  const call=text=>calls.find(call=>call.node.getText(sourceFile)===text),key=ref=>ref.partitionId+':'+ref.localId;
  const named=name=>sourceFile.statements.find(node=>node.name?.text===name);
  const alternatives=call('selected(a,b)');
  assert.deepEqual(new Set(alternatives.targets.map(key)),new Set([declarationRef(named('first')),declarationRef(named('second'))].map(key)));
  const derived=named('Derived').members[0],patched=declarationRef(named('replacement'));
  assert.ok(call('object.run(4)').targets.some(ref=>key(ref)===key(declarationRef(derived))));
  assert.ok(call('object.run(4)').targets.some(ref=>key(ref)===key(patched)));
  assert.equal(call('object.run(4)').incomplete,true,'receiver/prototype runtime replacement remains open');
  assert.ok(call('object.inherited(5)').targets.some(ref=>key(ref)===key(declarationRef(named('Base').members[1]))));
  const document=fixture.group.flowDocuments[0];document.calls=calls;
  assert.ok(call('reassigned(10,11)').targets.some(ref=>key(ref)===key(declarationRef(named('second')))));
  assert.equal(call('reassigned(10,11)').certainty,'modeled');
  assert.ok(call('this.method(x)').targets.some(ref=>key(ref)===key(declarationRef(named('StaticBase').members[0]))));
  assert.equal(call('accessor.callback(8,9)').targets.some(ref=>key(ref)===key(declarationRef(named('Box').members[2]))),false,'getter declaration is not the returned callable');

  const partitions=await collectCompilerCrossFileFlow(fixture),all=[...fixture.syntaxPartitions,...partitions],store=fixture.storeFor(all);
  await validateSemanticPartitions({store,partitions:all});
  const edges=[];for(const partition of all)for await(const edge of store.iterateRows(partition.partitionId,'semantic_edges'))edges.push(edge);
  assert.equal(edges.filter(edge=>edge.kind==='returnToResult'&&key(edge.callSite)===key(alternatives.occurrence)).length,2,'both source callees retain return channels');
  assert.ok(edges.filter(edge=>edge.kind==='argumentToParameter'&&edge.callSite&&key(edge.callSite)===key(alternatives.occurrence)).length>=4,'each modeled alternative retains positional parameter channels');
  const flows=(from,to)=>{const visited=new Set([key(from)]);for(const ref of visited)for(const edge of edges)if(key(edge.from)===ref&&['flowsTo','reads','writes','defines','returns','packs'].includes(edge.kind))visited.add(key(edge.to));return visited.has(key(to));};
  for(const name of ['heap','finite']) {
    const owner=named(name),write=doc.nodes.find(node=>ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&node.getStart(sourceFile)>=owner.pos&&node.end<=owner.end&&ts.isElementAccessExpression(node.left));
    assert.ok(flows(expressionFor(write.right),expressionFor(owner.body.statements.at(-1).expression)),name+' computed alias writes reach a following concrete read');
  }
  const receiverSummary=document.summaries.find(summary=>summary.owner.name?.text==='set');
  assert.ok(receiverSummary.effects.some(effect=>effect.parameter===-1&&effect.path[0]==='value'),'method writes retain receiver effects');
  const receiverCall=call('box.set(input)'),receiverOwner=named('receiver');
  assert.ok(edges.some(edge=>edge.kind==='writes'&&edge.callSite&&key(edge.callSite)===key(receiverCall.occurrence)&&key(edge.to)===key(expressionFor(receiverOwner.body.statements.at(-1).expression))),'receiver effects are instantiated at the caller read');
  const restCall=call('rest(a,b)');
  assert.equal(edges.filter(edge=>edge.kind==='packs'&&edge.callSite&&key(edge.callSite)===key(restCall.occurrence)).length,2,'rest packs all supplied arguments');
  assert.equal(document.summaries.find(summary=>summary.owner.name?.text==='implicit').returns.length,2);
  assert.equal(document.summaries.find(summary=>summary.owner.name?.text==='bare').returns.length,1);
  assert.equal(document.summaries.find(summary=>summary.owner.name?.text==='overridden').returns.length,1);
  console.log('Mutable/computed heap aliases, call alternatives, class/prototype dispatch and undefined completions passed');
} finally {await fs.rm(root,{recursive:true,force:true});}
