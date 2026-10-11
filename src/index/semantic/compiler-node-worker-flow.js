import path from 'node:path';
import { createCompilerBoundaryAuthority } from './compiler-boundary-authority.js';
import { throwIfAborted } from '../../shared/abort.js';
const keyPath = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const nodeAuthority = value => value?.family === 'node-type-package' && ['worker_threads','node:worker_threads'].includes(value.moduleName);
/** Node callbacks consume the payload directly (not browser MessageEvent.data).
 * https://nodejs.org/api/worker_threads.html — retained-source candidates only. */
export const collectCompilerNodeWorkerFlow = async ({group,documents,entries,ledgers,boundary,edge,enabledFor,signal}) => {
  const authority=createCompilerBoundaryAuthority(group), endpoints=new WeakMap(), consumers=[], constructions=[];
  const declaration = (doc,node) => authority.declaration(doc.checker.getResolvedSignature(node)?.declaration);
  const symbol = (doc,node) => {let value=doc.checker.getSymbolAtLocation(node);if(value?.flags & doc.ts.SymbolFlags.Alias)value=doc.checker.getAliasedSymbol(value);return value;};
  const named = async (doc,node,name) => {
    for(const candidate of symbol(doc,node)?.declarations||[]) {const value=await authority.declaration(candidate);if(nodeAuthority(value)&&value.names.includes(name))return true;}return false;
  };
  const endpoint = async (doc,input,seen=new Set()) => {
    const ts=doc.ts;if(!input||seen.has(input)||seen.size>=32)return null;seen=new Set(seen).add(input);
    if(ts.isParenthesizedExpression(input)||ts.isAsExpression(input)||ts.isNonNullExpression(input))return endpoint(doc,input.expression,seen);
    if(await named(doc,ts.isPropertyAccessExpression(input)?input.name:input,'parentPort'))return {kind:'parent',doc};
    if(ts.isIdentifier(input)) {
      const declaration=symbol(doc,input)?.valueDeclaration;
      if(declaration&&ts.isBindingElement(declaration)&&ts.isObjectBindingPattern(declaration.parent)&&ts.isVariableDeclaration(declaration.parent.parent)) {
        const owner=declaration.parent.parent,key=declaration.propertyName||declaration.name;
        if(owner.parent.flags & ts.NodeFlags.Const && ts.isIdentifier(key)&&['port1','port2'].includes(key.text)&&!declaration.initializer&&!declaration.dotDotDotToken) {
          const channel=await endpoint(doc,owner.initializer,seen);if(channel?.kind==='channel')return {kind:'port',doc,node:channel.node,port:key.text};
        }
      }
      if(declaration&&ts.isVariableDeclaration(declaration)&&declaration.getSourceFile()===doc.sourceFile&&declaration.parent.flags & ts.NodeFlags.Const)return endpoint(doc,declaration.initializer,seen);
      return null;
    }
    if(endpoints.has(input))return endpoints.get(input);
    if(ts.isNewExpression(input)) {
      const verified=await declaration(doc,input);if(!nodeAuthority(verified))return null;
      const result=verified.names.includes('Worker')?{kind:'worker',doc,node:input}:verified.names.includes('MessageChannel')?{kind:'channel',doc,node:input}:null;
      if(result)endpoints.set(input,result);return result;
    }
    if(ts.isPropertyAccessExpression(input)&&['port1','port2'].includes(input.name.text)) {
      const channel=await endpoint(doc,input.expression,seen);
      if(channel?.kind==='channel')return {kind:'port',doc,node:channel.node,port:input.name.text};
    }
    return null;
  };
  const properties = (doc,node) => {
    if(!node)return new Map();if(!doc.ts.isObjectLiteralExpression(node))return null;
    const result=new Map();
    for(const property of node.properties) {
      if(!doc.ts.isPropertyAssignment(property)&&!doc.ts.isShorthandPropertyAssignment(property))return null;
      const name=property.name;if(!doc.ts.isIdentifier(name)&&!doc.ts.isStringLiteralLike(name)||result.has(name.text)||name.text==='__proto__')return null;
      result.set(name.text,doc.ts.isPropertyAssignment(property)?property.initializer:property.name);
    }
    return result;
  };
  const entryCache=new WeakMap();
  const resolveEntry = async worker => {
    const {doc,node}=worker,ts=doc.ts,options=properties(doc,node.arguments?.[1]);
    if(!options || options.has('eval')&&options.get('eval').kind!==ts.SyntaxKind.FalseKeyword) {ledgers.get(doc).reasons.add('node_worker_dynamic_or_eval_options');return null;}
    const url=node.arguments?.[0];if(!url||!ts.isNewExpression(url))return null;
    const verified=await declaration(doc,url);
    if(!(verified?.family==='typescript-default-library'&&verified.names.includes('URL')||verified?.family==='node-type-package'&&verified.names.includes('URL')&&['url','node:url'].includes(verified.moduleName)))return null;
    const [filename,base]=url.arguments||[];
    if(!filename||!ts.isStringLiteralLike(filename)||!filename.text.startsWith('.')||/[?#\\%]/.test(filename.text)||!base||!ts.isPropertyAccessExpression(base)||base.name.text!=='url'||!ts.isMetaProperty(base.expression)||base.expression.keywordToken!==ts.SyntaxKind.ImportKeyword)return null;
    const container=doc.containerPath||(!doc.item.source.mapping?doc.item.source.path:null);
    const candidates=container&&entries.get(keyPath(path.resolve(group.repoRoot,path.dirname(container),filename.text)));
    return candidates?.length===1?candidates[0]:null;
  };
  const entryFor = worker => {if(!entryCache.has(worker.node))entryCache.set(worker.node,resolveEntry(worker));return entryCache.get(worker.node);};
  let joinWork=100000;
  const consumeJoin = doc => {throwIfAborted(signal);if(--joinWork>=0)return true;ledgers.get(doc).reasons.add('node_worker_join_work_budget');return false;};
  const make = (doc,node,kind,invocation,toContext=null,fromContext=null) => {
    const ref=boundary(doc,node,kind,invocation,toContext,fromContext);
    ledgers.get(doc).rows.at(-1).row.data.modelId='node-type-package/worker_threads/'+kind;return ref;
  };
  const callback = (doc,node) => {
    if(doc.ts.isArrowFunction(node)||doc.ts.isFunctionExpression(node))return node;
    const declaration=symbol(doc,node)?.valueDeclaration;
    return declaration&&doc.ts.isFunctionDeclaration(declaration)?declaration:declaration&&doc.ts.isVariableDeclaration(declaration)&&declaration.parent.flags & doc.ts.NodeFlags.Const&&declaration.initializer&&doc.ts.isFunctionLike(declaration.initializer)?declaration.initializer:null;
  };
  const payloadUses=new Map(),workerData=new Map();
  for(const doc of documents) {
    const uses=new Map(),data=[];payloadUses.set(doc,uses);workerData.set(doc,data);
    for(const node of doc.nodes) {
      throwIfAborted(signal);
      if(doc.ts.isIdentifier(node)) {
        const ref=doc.expressionFor(node),value=doc.checker.getSymbolAtLocation(node);if(ref&&value) {if(!uses.has(value))uses.set(value,[]);uses.get(value).push({node,ref});}
        if(ref&&!doc.ts.isImportSpecifier(node.parent)&&!doc.ts.isImportClause(node.parent)&&await named(doc,node,'workerData'))data.push(ref);
      }
    }
  }
  for(const doc of documents) if(enabledFor(doc)) for(const observation of doc.observations) {
    const node=observation.node,ts=doc.ts;if(!node||!observation.invocation)continue;
    if(ts.isNewExpression(node)) {const value=await endpoint(doc,node);if(value?.kind==='worker')constructions.push({...value,entry:await entryFor(value)});continue;}
    if(!ts.isCallExpression(node)||!ts.isPropertyAccessExpression(node.expression)||!['on','once','addListener'].includes(node.expression.name.text)||node.arguments.length<2||!ts.isStringLiteralLike(node.arguments[0])||node.arguments[0].text!=='message')continue;
    const verified=await declaration(doc,node);
    if(!verified||verified.family!=='node-type-package'||!['worker_threads','node:worker_threads','events','node:events'].includes(verified.moduleName))continue;
    const receiver=await endpoint(doc,node.expression.expression),fn=callback(doc,node.arguments[1]);
    if(!receiver||!fn)continue;
    const parameter=fn.parameters[0];if(!parameter||!ts.isIdentifier(parameter.name)){ledgers.get(doc).reasons.add('node_worker_message_binding_pattern_unresolved');continue;}
    const parameterSymbol=doc.checker.getSymbolAtLocation(parameter.name);
    const data=(payloadUses.get(doc).get(parameterSymbol)||[]).filter(use=>use.node!==parameter.name&&use.node.pos>=fn.pos&&use.node.end<=fn.end).map(use=>use.ref);
    consumers.push({doc,node,receiver,data,invocation:doc.expressionFor(node)});
  }
  for(const worker of constructions) {
    const {doc,node,entry}=worker,invocation=doc.expressionFor(node),ledger=ledgers.get(doc);ledger.observed++;
    const request=make(doc,node,'node-worker-construction-request',invocation,entry?'source:'+entry.item.source.sourceUnitId:null);
    edge(doc,'dispatches',invocation,request,invocation);
    const options=properties(doc,node.arguments?.[1]),data=options?.get('workerData');
    if(data) {
      const clone=make(doc,data,'node-worker-data-clone-request',invocation);edge(doc,'packs',doc.expressionFor(data),clone,invocation,1);
      edge(doc,'dispatches',clone,request,invocation);
      if(entry&&enabledFor(entry))for(const target of workerData.get(entry)||[]) {if(!consumeJoin(doc))break;edge(doc,'consumes',request,target,invocation,1);}
    }
    if(!entry)ledger.reasons.add('node_worker_entry_not_in_exact_inventory');
    else ledger.completed++;
    ledger.reasons.add('node_worker_activation_options_clone_and_transfer_unobserved');
  }
  for(const doc of documents) if(enabledFor(doc)) for(const observation of doc.observations) {
    const call=observation.node,ts=doc.ts;
    if(!call||!ts.isCallExpression(call)||!ts.isPropertyAccessExpression(call.expression)||call.expression.name.text!=='postMessage')continue;
    const verified=await declaration(doc,call);if(!nodeAuthority(verified))continue;
    const receiver=await endpoint(doc,call.expression.expression),invocation=doc.expressionFor(call);if(!receiver||!invocation)continue;
    const ledger=ledgers.get(doc);ledger.observed++;
    const dispatch=make(doc,call,'node-worker-message-dispatch-request',invocation);
    edge(doc,'dispatches',invocation,dispatch,invocation);
    for(let ordinal=0;ordinal<call.arguments.length;ordinal++)edge(doc,'consumes',doc.expressionFor(call.arguments[ordinal]),dispatch,invocation,ordinal);
    if(call.arguments[0]) {const clone=make(doc,call.arguments[0],'node-worker-clone-request',invocation);edge(doc,'packs',doc.expressionFor(call.arguments[0]),clone,invocation,0);edge(doc,'dispatches',clone,dispatch,invocation);}
    const targetEntry=receiver.kind==='worker'?await entryFor(receiver):null;
    let matched=0;
    for(const consumer of consumers) {
      if(!consumeJoin(doc))break;
      const other=consumer.receiver;
      const matches=receiver.kind==='worker'&&other.kind==='parent'&&consumer.doc===targetEntry
        || receiver.kind==='parent'&&other.kind==='worker'&&await entryFor(other)===doc
        || receiver.kind==='port'&&other.kind==='port'&&other.node===receiver.node&&other.doc===doc&&other.port!==receiver.port;
      if(!matches)continue;
      const receive=make(consumer.doc,consumer.node,'node-worker-message-consumer-candidate',consumer.invocation,'source:'+consumer.doc.item.source.sourceUnitId,'source:'+doc.item.source.sourceUnitId);
      edge(doc,'dispatches',dispatch,receive,invocation);for(const target of consumer.data) {if(!consumeJoin(doc))break;edge(consumer.doc,'consumes',receive,target,invocation,0);}matched++;
    }
    if(matched)ledger.completed++;else ledger.reasons.add('node_worker_peer_or_consumer_unresolved');
    ledger.reasons.add('node_worker_registration_order_instance_transfer_and_delivery_unobserved');
  }
};
