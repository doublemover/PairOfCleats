import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {createCompilerBoundaryFixture} from '../../helpers/compiler-boundary-fixture.js';
import {createSemanticLspSession} from '../../../src/index/semantic/lsp-session.js';
import {mergeSemanticProviderOutput} from '../../../src/index/semantic/merge-provider.js';
import {joinProviderCallSummaries} from '../../../src/index/semantic/provider-call-joins.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-provider-joins-'));
try {
  const text='export function implementation(value:number){return value;} declare const remote:(value:number)=>number; const answer=remote(5); declare const service:{run:(value:number)=>number}; service.run(7);';
  const f=await createCompilerBoundaryFixture(root,{'input.ts':text},{},{withFlow:true}),doc=f.documents[0],runtime={root,buildRoot:root,semanticPolicy:f.policy};
  const session=await createSemanticLspSession({state:f.state,runtime}),document=session.prepareDocuments([])[0],uri=pathToFileURL(path.join(root,'input.ts')).href;
  const targets=await session.targetsForDocument(document),target=targets.find(value=>value.name==='remote'&&value.roles.includes('call'));
  assert.ok(target?.invocation,'provider symbol occurrence is qualified by its actual invocation');
  assert.equal(targets.find(value=>value.name==='service')?.invocation,null,'member receiver cannot become a provider call target');
  assert.ok(targets.find(value=>value.name==='run'&&value.span[0]===text.lastIndexOf('run'))?.invocation,'member name retains its call site');
  const name=doc.sourceFile.statements[0].name;
  await session.collectDocument({doc:document,uri,targets:[target],requestDefinition:async()=>({attempted:true,payload:[{uri,range:{start:{line:0,character:name.getStart()},end:{line:0,character:name.end}}}]})});
  const output=session.output(),before=[...f.state.semanticFactsByFile];
  const unknown={...output.partitions[0],partitionId:'sa1:'+'f'.repeat(64),sourceUnitId:'su1:'+'e'.repeat(64)};
  await assert.rejects(mergeSemanticProviderOutput({output:{...output,partitions:[...output.partitions,unknown]},state:f.state,runtime}),{code:'ERR_SEMANTIC_SOURCE_MISMATCH'});
  assert.deepEqual([...f.state.semanticFactsByFile],before,'failed multi-provider merge cannot partially select earlier partitions');
  await mergeSemanticProviderOutput({output:{...output,partitions:[...output.partitions,...output.partitions]},state:f.state,runtime});
  assert.equal(new Set(f.state.semanticFactsByFile.get('input.ts').partitions.map(row=>row.partitionId)).size,f.state.semanticFactsByFile.get('input.ts').partitions.length,'identical provider partitions select once');
  const selected=f.state.semanticFactsByFile.get('input.ts');
  await assert.rejects(mergeSemanticProviderOutput({output:{...output,partitions:[{...output.partitions[0],canonicalHash:'a'.repeat(64)}]},state:f.state,runtime}),/immutable partition/);
  assert.equal(f.state.semanticFactsByFile.get('input.ts'),selected);
  const call=doc.nodes.find(node=>doc.ts.isCallExpression(node));
  f.group.flowDocuments[0].calls=[{occurrence:doc.expressionFor(call),result:doc.expressionFor(call),span:[call.getStart(),call.end],targets:[],incompleteTargets:true,arguments:call.arguments.map(doc.expressionFor),invocationKind:'call',hasSpread:false}];
  const store=f.storeFor([...f.syntaxPartitions,...output.partitions]);
  const joined=await joinProviderCallSummaries({...f,store,output});
  assert.equal(joined.length,1);
  const edges=[],coverage=[];for(const partition of joined){for await(const row of f.storeFor(joined).iterateRows(partition.partitionId,'semantic_edges'))edges.push(row);for await(const row of f.storeFor(joined).iterateRows(partition.partitionId,'semantic_coverage'))coverage.push(row);}
  assert.ok(edges.some(edge=>edge.kind==='returnToResult'));
  assert.ok(edges.some(edge=>edge.kind==='argumentToParameter'));
  assert.ok(coverage.some(row=>row.reason.includes('provider_call_target_candidates')&&row.reason.includes('unknown_call_return_remainder')),'provider candidate supplements the unknown runtime remainder');
  console.log('Atomic provider selection and source-pinned provider/call-summary joins passed');
}finally{await fs.rm(root,{recursive:true,force:true});}
