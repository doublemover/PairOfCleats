import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createCompilerBoundaryFixture} from '../../helpers/compiler-boundary-fixture.js';
import {createCompilerDispatchResolver} from '../../../src/index/semantic/compiler-dispatch.js';
import {collectCompilerImplicitCalls} from '../../../src/index/semantic/compiler-implicit-calls.js';
import {collectCompilerCrossFileFlow} from '../../../src/index/semantic/compiler-cross-file-flow.js';
import {compilerPropertyKeys,propertyPathsOverlap} from '../../../src/index/semantic/compiler-property-paths.js';
import {validateSemanticPartitions} from '../../../src/index/semantic/reconcile.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-object-effects-'));
try {
  const fixture=await createCompilerBoundaryFixture(root,{'input.ts':`export {};
    function first(x:number){return x;}function second(x:number){return x+1;}
    class Base {constructor(public inherited:number=0){} #slot=3; get base(){return this.#slot;}}
    class Box extends Base {#slot=4; field=7; constructor(public parameter:number){super(parameter);this.#slot=parameter;}
      get value(){return this.#slot;}set value(input:number){this.#slot=input;}
      get callback(){return first;}get other(){return second;}}
    function run(input:number){const box=new Box(input);box.value=input;const stored=box.value;const field=box.field;const parameter=box.parameter;return stored;}
    class Forwarded extends Box {} const forwarded=new Forwarded(9);
    const selected=new Box(1);selected.callback(2);selected.other(3);
  `},{},{withFlow:true});
  const doc=fixture.documents[0],{ts,checker,sourceFile,expressionFor}=doc;
  const declarationRef=node=>{const anchor=node.name||node;return doc.item.declarations.get(anchor.getStart()+':'+anchor.end)||(ts.isFunctionLike(node)?expressionFor(node):null);};
  const resolver=createCompilerDispatchResolver({ts,checker,nodes:doc.nodes,declarationRef});
  const calls=doc.nodes.filter(node=>ts.isCallExpression(node)||ts.isNewExpression(node)).map(node=>{const result=resolver(node);return {node,occurrence:expressionFor(node),result:expressionFor(node),span:[node.getStart(),node.end],targets:result.targets,incompleteTargets:result.incomplete,invocationKind:ts.isNewExpression(node)?'construct':'call',suppressResult:ts.isNewExpression(node),receiver:ts.isNewExpression(node)?expressionFor(node):ts.isPropertyAccessExpression(node.expression)?expressionFor(node.expression.expression):null,arguments:(node.arguments||[]).map(expressionFor),hasSpread:false};});
  const forwarded=calls.find(call=>call.node.getText()==='new Forwarded(9)'),explicit=calls.find(call=>call.node.getText()==='new Box(input)');
  assert.deepEqual(forwarded.targets,explicit.targets,'default derived constructors forward to the explicit base candidate');
  assert.ok(calls.find(call=>call.node.getText()==='super(parameter)').targets.length,'explicit super calls retain their base constructor');
  const implicit=collectCompilerImplicitCalls({ts,checker,nodes:doc.nodes,expressionFor,declarationRef});calls.push(...implicit);
  const key=ref=>ref.partitionId+':'+ref.localId;
  assert.ok(implicit.some(call=>call.invocationKind==='setter'&&call.node.getText()==='box.value'));
  const callback=calls.find(call=>call.node.getText()==='selected.callback(2)');
  assert.ok(callback.targets.some(ref=>key(ref)===key(declarationRef(sourceFile.statements[1]))),'getter return supplies the source callable');
  const privateNodes=doc.nodes.filter(node=>ts.isPrivateIdentifier(node)&&ts.isPropertyDeclaration(node.parent));
  const keys=privateNodes.map(node=>compilerPropertyKeys({ts,checker,node,reasons:new Set()})[0]);
  assert.equal(propertyPathsOverlap([keys[0]],[keys[1]]),false,'same private spelling has distinct class brands');
  assert.equal(propertyPathsOverlap([null],[keys[0]]),false,'dynamic public key cannot access a private slot');
  fixture.group.flowDocuments[0].calls=calls;
  const added=await collectCompilerCrossFileFlow(fixture),all=[...fixture.syntaxPartitions,...added],store=fixture.storeFor(all);
  await validateSemanticPartitions({store,partitions:all});
  const edges=[];for(const partition of all)for await(const edge of store.iterateRows(partition.partitionId,'semantic_edges'))edges.push(edge);
  const setter=implicit.find(call=>call.invocationKind==='setter'&&call.node.getText()==='box.value');
  assert.ok(edges.some(edge=>edge.kind==='argumentToParameter'&&edge.callSite&&key(edge.callSite)===key(setter.occurrence)));
  const construction=calls.find(call=>call.node.getText()==='new Box(input)');
  assert.ok(edges.some(edge=>edge.kind==='writes'&&edge.callSite&&key(edge.callSite)===key(construction.occurrence)),'constructor parameter properties reach following reads');
  assert.ok(!edges.some(edge=>edge.kind==='returnToResult'&&edge.callSite&&key(edge.callSite)===key(construction.occurrence)),'constructor implicit undefined is not the allocation result');
  const field=doc.nodes.find(node=>ts.isPropertyAccessExpression(node)&&node.getText()==='box.field'),initializer=doc.nodes.find(node=>ts.isPropertyDeclaration(node)&&node.name.getText()==='field').initializer;
  const reached=new Set([key(expressionFor(initializer))]);for(const ref of reached)for(const edge of edges)if(key(edge.from)===ref&&['packs','flowsTo','reads','writes','defines'].includes(edge.kind))reached.add(key(edge.to));
  assert.ok(reached.has(key(expressionFor(field))),'visible instance initializer reaches the allocation field read');
  console.log('Constructor, parameter property, getter/setter and private brand may-flow contracts passed');
} finally {await fs.rm(root,{recursive:true,force:true});}
