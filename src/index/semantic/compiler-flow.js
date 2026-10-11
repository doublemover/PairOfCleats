import { SEMANTIC_ANALYSIS_VERSIONS } from './analysis-versions.js';
import { propertyPathsOverlap } from './compiler-property-paths.js';
import { compilerCallAdapter } from './compiler-call-adapter.js';
import { compilerRuntimeParameters, compilerInvocationInputs } from './compiler-invocation.js';
import { createCompilerFieldPaths, collectCompilerAliasAssignments } from './compiler-flow-fields.js';
import { buildCompilerFlowGraph } from './compiler-flow-graph.js';
import { createAnalysisPartitionId, semanticHash, canonicalSemanticJson } from './identity.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { throwIfAborted } from '../../shared/abort.js';
/** Source-owned definition versions plus monotone reaching-definition joins. */
export const collectCompilerFlow = async ({ ts, checker, isDefaultLibrary, sourceFile, nodes, expressionFor, declarationFor,
  source, bytes, bindingPartition, context, root, policy, diskAccount, signal }) => {
  if (['off', 'deferred'].includes(policy.enrichment.localFlow)) return null;
  const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-cfg-flow', version: SEMANTIC_ANALYSIS_VERSIONS.cfgFlow },
    inputPartitionHashes: [bindingPartition.canonicalHash], compilerContext: context, dependencySummaryHashes: [],
    analysisPolicy: { maxSccIterations: policy.enrichment.maxSccIterations, version: Number(SEMANTIC_ANALYSIS_VERSIONS.cfgFlow), fieldPathDepth: policy.enrichment.fieldPathDepth } });
  const local = key => ({ local: key }), ledger = new Map(), edges = [], operands = [], allReasons = new Set(), summaries = [], fieldAccesses = [], aliases = [], callEffects = [];
  const add = (key, kind, node, data) => {
    if (!ledger.has(key)) ledger.set(key, { kind, span: node ? [node.getStart(sourceFile), node.end] : null, scope: null, data });
    return local(key);
  };
  const evidence = add('evidence', 'evidence', null, { method: 'structured-cfg-reaching-definitions', producerId: 'semantic-flow',
    producerVersion: SEMANTIC_ANALYSIS_VERSIONS.cfgFlow, evidenceKind: 'static-analysis', sourceRef: source.sourceUnitId, artifactRef: null });
  const edge = (kind, from, to, condition = null, certainty = 'exact-static') => {
    if (from && to) edges.push({ kind, from, to, callSite: null, operandOrdinal: null, contextKey: context.contextKey, condition, evidence, certainty });
  };
  nodes = [...nodes];
  const assignments = collectCompilerAliasAssignments(ts,checker,nodes);
  const owners = [sourceFile, ...nodes.filter(node => ts.isFunctionLike(node) && node.body)];
  let totalBlocks = 0, solvedBlocks = 0;
  for (const owner of owners) {
    const reasons = new Set();
    throwIfAborted(signal);
    const ownerRef = expressionFor(owner);
    if (!ownerRef) { allReasons.add('missing_function_syntax_anchor'); continue; }
    const prefix = owner.getStart(sourceFile) + ':' + owner.end + ':' + ts.SyntaxKind[owner.kind];
    const graph = buildCompilerFlowGraph({ ts, owner, sourceFile, expressionFor, signal });
    for (const reason of graph.reasons) reasons.add(reason);
    const reachable = new Set(), pending = [graph.entry], predecessors = new Map();
    while (pending.length) {
      const block = pending.pop(); if (reachable.has(block)) continue; reachable.add(block);
      for (const successor of block.successors) { if (!predecessors.has(successor.to)) predecessors.set(successor.to, []); predecessors.get(successor.to).push(block); pending.push(successor.to); }
    }
    const symbols = new Map(), blockRefs = new Map(), writes = new Map(), heapWrites = new Map(), catches = new Map();
    const fields = createCompilerFieldPaths({ ts, checker, owner, sourceFile, assignments, expressionFor, declarationFor,
      depthLimit: policy.enrichment.fieldPathDepth, reasons });
    const fieldsFor = node => fields.locationsFor(node).map(location => {
      const token = 'field:' + location.key;
      if (!symbols.has(token)) symbols.set(token, {key:token,site:location.site,unknown:null,location});
      return token;
    });
    const symbolFor = node => {
      if (!node || !ts.isIdentifier(node)) return null;
      const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
      if (!symbol) { reasons.add('unresolved_local_binding'); return null; }
      if (!symbols.has(symbol)) {
        const declaration = symbol.declarations?.find(d => d.getSourceFile() === sourceFile);
        const site = declaration ? declarationFor(declaration) || expressionFor(declaration.name || declaration) : null;
        if (!site) { reasons.add('captured_or_external_binding_without_local_definition'); return null; }
        symbols.set(symbol, { key: canonicalSemanticJson(site), site, unknown: null });
      }
      return symbol;
    };
    for (const block of reachable) {
      blockRefs.set(block, add('block:' + prefix + ':' + block.key, 'block', block.node, { owner: ownerRef, blockKind: block.kind }));
      if (block.event?.predicate) {
        const predicate = block.event.predicate;
        block.condition = add('guard:' + prefix + ':' + block.key, 'expression', block.node,
          { astKind: 'SemanticPredicate', operation: predicate.operation, invocationKind: null, syntacticArgumentCount: null, flags: ['derived'] });
        predicate.inputs.forEach((input, ordinal) => {
          const child = expressionFor(input);
          if (child) operands.push({ parent: block.condition, slot: ordinal === 0 ? 'left' : 'right', ordinal: 0, child, flags: [] });
        });
      }
      if (['heapRead', 'heapWrite'].includes(block.event?.kind)) {
        const candidates = fieldsFor(block.event.target);
        block.fields = candidates;
        const field = candidates[0];
        if (field && block.event.kind === 'heapWrite') {
          const value = add('heap-write:' + prefix + ':' + block.key, 'value', block.event.target,
            { origin: 'heap', site: expressionFor(block.event.value) || block.site, storage: candidates.length===1 ? symbols.get(field).location.root : null });
          heapWrites.set(block, value);
          edge('flowsTo', expressionFor(block.event.value), value, null, 'modeled');
          edge('writes', value, expressionFor(block.event.target), null, 'modeled');
        }
      }
      const symbol = symbolFor(block.event?.target);
      if (symbol) block.symbol = symbol;
      if (['write', 'catch'].includes(block.event?.kind) && symbol) {
        const value = add('write:' + prefix + ':' + block.key, 'value', block.event.target,
          { origin: block.event.origin, site: expressionFor(block.event.value) || block.site, storage: null });
        writes.set(block, value);
        if (block.event.kind === 'catch') catches.set(block, value);
        if (block.event.kind !== 'catch') edge('defines', block.event.origin === 'parameter' ? declarationFor(block.event.target.parent) : expressionFor(block.event.value), value);
        edge('writes', value, expressionFor(block.event.target));
      }
    }
    for (const entry of symbols.values()) entry.unknown = add('unknown:' + prefix + ':' + entry.key, 'value', null,
      { origin: entry.location ? 'heap' : 'unknown', site: entry.site, storage: entry.location?.root || null });
    for (const entry of symbols.values()) for (const initializer of entry.location?.initializers || []) edge('packs', initializer, entry.unknown, null, 'modeled');
    const initial = new Map([...symbols].map(([symbol, entry]) => [symbol, new Set([entry.unknown.local])]));
    const overlaps = new Map(), fieldGroups = new Map(); let fieldWork = 1000000;
    for(const [token,entry] of symbols) if(entry.location) {
      const key=canonicalSemanticJson(entry.location.root); if(!fieldGroups.has(key))fieldGroups.set(key,[]);fieldGroups.get(key).push([token,entry]);
    }
    for(const group of fieldGroups.values()) for(const [token,entry] of group) {
      const matches=[]; overlaps.set(token,matches);
      for(const [other,value] of group) {
        if(--fieldWork<0) {reasons.add('field_overlap_work_budget');break;}
        if(propertyPathsOverlap(entry.location.path,value.location.path))matches.push(other);
      }
    }
    const incoming = new Map(), outgoing = new Map();
    const merge = block => {
      const result = new Map();
      const parents = predecessors.get(block) || [];
      if (block === graph.entry) return new Map([...initial].map(([key, values]) => [key, new Set(values)]));
      for (const parent of parents) for (const [symbol, values] of outgoing.get(parent) || []) {
        if (!result.has(symbol)) result.set(symbol, new Set());
        for (const value of values) result.get(symbol).add(value);
      }
      return result;
    };
    const equal = (a, b) => Boolean(a && a.size === b.size && [...b].every(([key, values]) => a.has(key)
      && a.get(key).size === values.size && [...values].every(value => a.get(key).has(value))));
    const queue = [graph.entry], queued = new Set(queue);
    let index = 0;
    const maxWork = policy.enrichment.maxSccIterations * Math.max(1, reachable.size);
    while (index < queue.length && index < maxWork) {
      throwIfAborted(signal);
      const block = queue[index++]; queued.delete(block);
      const input = merge(block), output = new Map([...input].map(([key, values]) => [key, new Set(values)]));
      incoming.set(block, input);
      if (writes.has(block)) output.set(block.symbol, new Set([writes.get(block).local]));
      // A field path is a may-location: retain older candidates rather than claiming an alias-safe kill.
      if (heapWrites.has(block)) for (const field of block.fields) {
        for (const token of overlaps.get(field) || [field]) output.set(token,new Set([...(output.get(token)||[]),heapWrites.get(block).local]));
      }
      if (!equal(outgoing.get(block), output)) {
        outgoing.set(block, output);
        for (const successor of block.successors) if (!queued.has(successor.to)) { queue.push(successor.to); queued.add(successor.to); }
      }
    }
    const complete = index === queue.length;
    // One reverse reachability pass for all pending returns, not one graph scan per return.
    const completionReachable = new Set([graph.exit]), completionPending = [graph.exit];
    while (completionPending.length) {
      throwIfAborted(signal);
      for (const parent of predecessors.get(completionPending.pop()) || []) {
        if (completionReachable.has(parent) || ['return', 'throw'].includes(parent.event?.kind)) continue;
        completionReachable.add(parent); completionPending.push(parent);
      }
    }
    const canCompleteReturn = block => block.successors.some(edge => completionReachable.has(edge.to));
    if (!complete) reasons.add('reaching_definition_iteration_budget');
    totalBlocks += reachable.size; solvedBlocks += complete ? reachable.size : outgoing.size;
    const returnRefs = [], exceptionRefs = [], effects = [], parameterFields = [];
    if(ts.isConstructorDeclaration(owner)) for(const parameter of owner.parameters) {
      if(ts.isIdentifier(parameter.name)&&parameter.modifiers?.some(modifier=>[ts.SyntaxKind.PublicKeyword,ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.ReadonlyKeyword].includes(modifier.kind))) {
        const input=declarationFor(parameter);if(input)effects.push({parameter:-1,path:[parameter.name.text],ref:input});
        reasons.add('constructor_parameter_property_initialization_modeled');
      }
    }
    let routingWork = 1000000;
    const exceptionTargets = block => {
      const targets = new Set(), seen = new Set(), pending = block.successors.filter(value => value.kind === 'exceptional' || block.event?.kind === 'throw').map(value => value.to);
      while (pending.length) {
        throwIfAborted(signal);
        if (--routingWork < 0) { reasons.add('exception_and_effect_route_budget'); break; }
        const current = pending.pop(); if (seen.has(current)) continue; seen.add(current);
        if (catches.has(current) || current === graph.exception) { targets.add(current); continue; }
        // A finally return/throw overrides the pending exception; do not route its payload onward.
        if (['return', 'throw'].includes(current.event?.kind)) continue;
        for (const next of current.successors) pending.push(next.to);
      }
      return targets;
    };
    for (const entry of symbols.values()) if (entry.location?.parameter !== null && entry.location?.parameter !== undefined)
      parameterFields.push({ parameter: entry.location.parameter, path: entry.location.path, ref: entry.unknown });
    for (const block of reachable) {
      const event = block.event;
      if (event?.kind === 'throw' || event?.mayThrow) {
        const payload = add('exception:' + prefix + ':' + block.key, 'value', block.node,
          { origin: 'unknown', site: expressionFor(event.value) || block.site, storage: null });
        if (event.kind === 'throw') edge('throws', expressionFor(event.value), payload, null, 'modeled');
        else {
          reasons.add('implicit_exception_payload_unresolved');
          if (ts.isCallExpression(block.node) || ts.isTaggedTemplateExpression(block.node) || ts.isNewExpression(block.node)) for (const { argument } of compilerInvocationInputs(ts, block.node).inputs) edge('flowsTo', expressionFor(argument), payload, null, 'modeled');
        }
        for (const target of exceptionTargets(block)) {
          if (catches.has(target)) edge('flowsTo', payload, catches.get(target), null, 'modeled');
          else { exceptionRefs.push(payload); edge('throws', payload, blockRefs.get(target), null, 'modeled'); }
        }
      }
      if (event?.kind === 'heapRead' && block.fields?.length) {
        const location = symbols.get(block.fields[0]).location;
        const values = new Set();
        for (const field of block.fields) { const entry = symbols.get(field); for(const candidate of incoming.get(block)?.get(field)||[entry.unknown.local]) values.add(candidate); if(!complete) values.add(entry.unknown.local); }
        const merged = add('heap-read:' + prefix + ':' + block.key, 'value', block.node,
          { origin: 'merge', site: block.site, storage: block.fields.length===1 ? location.root : null });
        for (const candidate of [...values].sort()) edge('flowsTo', local(candidate), merged, null, 'modeled');
        edge('reads', merged, block.site, null, 'modeled');
        for(const field of block.fields) { const location=symbols.get(field).location; fieldAccesses.push({ root: location.root, path: location.path, ref: block.site, span: [block.node.getStart(sourceFile), block.node.end] }); }
      }
      if (event?.kind === 'heapWrite' && heapWrites.has(block)) for(const field of block.fields) {
        const location = symbols.get(field).location;
        if (location.parameter !== null) effects.push({ parameter: location.parameter, path: location.path, ref: heapWrites.get(block) });
      }
      if ((event?.kind === 'operation' && (ts.isCallExpression(block.node) || ts.isTaggedTemplateExpression(block.node) || ts.isNewExpression(block.node))) || ['heapRead','heapWrite'].includes(event?.kind)) {
        const adapter=compilerCallAdapter({ts,checker,node:block.node,isDefaultLibrary});
        for(const argument of adapter?.runtimeArguments||compilerInvocationInputs(ts,block.node).runtimeArguments) fields.rootsFor(argument);
        if(adapter) {fields.rootsFor(adapter.receiver);for(const reason of adapter.reasons)reasons.add(reason);}
        const callee=['heapRead','heapWrite'].includes(event?.kind)?event.target:block.node.expression||block.node.tag;
        if(ts.isNewExpression(block.node))fields.rootsFor(block.node);
        if(callee?.kind===ts.SyntaxKind.SuperKeyword)fields.rootsFor(callee);
        if(callee&&(ts.isPropertyAccessExpression(callee)||ts.isElementAccessExpression(callee))) fields.rootsFor(callee.expression);
        const reads = [], seen = new Set(), pending = block.successors.filter(value => value.kind !== 'exceptional').map(value => value.to);
        while (pending.length) {
          throwIfAborted(signal);
          if (--routingWork < 0) { reasons.add('exception_and_effect_route_budget'); break; }
          const current = pending.pop(); if (seen.has(current)) continue; seen.add(current);
          if (current.event?.kind === 'heapRead') for(const field of current.fields || []) { const location = symbols.get(field).location; reads.push({ root: location.root, path: location.path, ref: current.site }); }
          for (const next of current.successors) pending.push(next.to);
        }
        const targets = [...exceptionTargets(block)];
        callEffects.push({ result: block.site, reads, exceptionTargets: targets.map(target => catches.get(target) || blockRefs.get(target)), exceptionEscapes: targets.includes(graph.exception) });
        if (reads.length) reasons.add('call_heap_effects_require_summary_or_unknown');
      }
    }
    aliases.push(...fields.aliases.values());
    for (const block of reachable) {
      for (const successor of block.successors) edge(successor.kind, blockRefs.get(block), blockRefs.get(successor.to), block.condition || successor.condition, 'modeled');
      const event = block.event;
      if (event?.kind === 'read' && block.symbol) {
        const values = new Set(incoming.get(block)?.get(block.symbol) || [symbols.get(block.symbol).unknown.local]);
        if (!complete) values.add(symbols.get(block.symbol).unknown.local);
        let value;
        if (values.size === 1) value = local([...values][0]);
        else {
          value = add('merge:' + prefix + ':' + block.key + ':' + symbols.get(block.symbol).key, 'value', block.node,
            { origin: 'merge', site: block.site, storage: null });
          for (const candidate of [...values].sort()) edge('flowsTo', local(candidate), value, null, 'modeled');
        }
        edge('reads', value, expressionFor(event.target), null, values.size > 1 || !complete || graph.reasons.size ? 'modeled' : 'exact-static');
      }
      if (event?.kind === 'return' && canCompleteReturn(block)) {
        const value = add('return:' + prefix + ':' + block.key, 'value', block.node,
          { origin: 'return', site: expressionFor(event.value) || block.site, storage: null });
        const input = event.value ? expressionFor(event.value) : add('undefined:' + prefix + ':' + block.key, 'expression', null, {astKind:'SemanticUndefined',operation:'undefined',invocationKind:null,syntacticArgumentCount:null,flags:['derived','bare-return']});
        edge('returns', input, value, null, graph.reasons.size ? 'modeled' : 'exact-static'); returnRefs.push(value);
      }
      if (event?.kind === 'throw' && event.value) {
        for (const successor of block.successors) edge('throws', expressionFor(event.value), blockRefs.get(successor.to), null, 'modeled');
      }
      if (event?.kind === 'operation') {
        const node = block.node;
        if (ts.isObjectLiteralExpression(node)) {
          for (const member of node.properties) edge('packs', expressionFor(ts.isPropertyAssignment(member) ? member.initializer : ts.isShorthandPropertyAssignment(member) ? member.name : member), block.site, null, 'modeled');
        } else if (ts.isArrayLiteralExpression(node)) {
          for (const element of node.elements) if (!ts.isOmittedExpression(element)) edge('packs', expressionFor(element), block.site, null, 'modeled');
        } else if (ts.isBinaryExpression(node)) {
          edge('flowsTo', expressionFor(node.left), block.site); edge('flowsTo', expressionFor(node.right), block.site);
        } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) edge('flowsTo', expressionFor(node.operand), block.site);
        else if (ts.isConditionalExpression(node)) {
          edge('flowsTo', expressionFor(node.whenTrue), block.site, expressionFor(node.condition), 'modeled');
          edge('flowsTo', expressionFor(node.whenFalse), block.site, expressionFor(node.condition), 'modeled');
        }
      }
    }
    const completionStates = new Set(), completionQueue = [[graph.entry,false]];
    let normalExit = false;
    while(completionQueue.length) {
      throwIfAborted(signal);
      const [block,pendingReturn] = completionQueue.pop(), key = block.key + ':' + pendingReturn;
      if(completionStates.has(key)) continue; completionStates.add(key);
      if(block === graph.exit && !pendingReturn) normalExit = true;
      const pending = block.event?.kind === 'return' ? true : ['throw','catch'].includes(block.event?.kind) ? false : pendingReturn;
      for(const successor of block.successors) completionQueue.push([successor.to,successor.kind === 'exceptional' ? false : pending]);
    }
    if (owner !== sourceFile && normalExit) {
      const input = add('undefined:' + prefix, 'expression', null, {astKind:'SemanticUndefined',operation:'undefined',invocationKind:null,syntacticArgumentCount:null,flags:['derived','implicit-return']});
      const result = add('implicit-return:' + prefix, 'value', null, {origin:'return',site:ownerRef,storage:null});
      edge('returns',input,result,null,'modeled'); returnRefs.push(result);
    }
    summaries.push({ owner, ownerRef, span: [owner.getStart(sourceFile), owner.end], declaration: owner.parent && ts.isVariableDeclaration(owner.parent) && owner.parent.initializer === owner ? declarationFor(owner.parent) : declarationFor(owner) || (owner !== sourceFile ? ownerRef : null), returns: returnRefs,
      constructible:ts.isConstructorDeclaration(owner)||ts.isFunctionDeclaration(owner)||ts.isFunctionExpression(owner), lexicalReceiver: ts.isArrowFunction(owner), restIndex: compilerRuntimeParameters(ts,owner).findIndex(parameter=>parameter.dotDotDotToken),
      parameters: compilerRuntimeParameters(ts,owner).map(parameter => declarationFor(parameter)), parameterFields, effects, exceptions: exceptionRefs, complete: complete && reasons.size === 0 });
    for (const reason of reasons) allReasons.add(reason);
  }
  const keys = [...ledger.keys()].sort(), ids = new Map(keys.map((key, id) => [key, id]));
  const expand = value => {
    if (value && typeof value === 'object') {
      if (Object.hasOwn(value, 'local')) {
        if (!ids.has(value.local)) throw new Error('Unknown local flow reference.');
        return { partitionId, localId: ids.get(value.local) };
      }
      if (Array.isArray(value)) return value.map(expand);
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
    }
    return value;
  };
  const rows = keys.map(key => ({ family: 'node', row: { id: ids.get(key), ...expand(ledger.get(key)) } }));
  for (const operand of operands) rows.push({ family: 'operand', row: expand(operand) });
  const unique = [...new Map(edges.map(value => { const row = expand(value); return [canonicalSemanticJson(row), row]; })).entries()].sort(([a], [b]) => a.localeCompare(b));
  unique.forEach(([, row], id) => rows.push({ family: 'edge', row: { id, ...row } }));
  const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'localFlow', state: allReasons.size ? 'partial' : 'complete',
    reason: allReasons.size ? [...allReasons].sort().join(';') : null, observedCount: totalBlocks, completedCount: solvedBlocks, frontierRef: null };
  rows.push({ family: 'coverage', row: coverage });
  const partition = await writeSemanticAnalysis({ rows, policy, stagingRoot: root, source, sourceBytes: bytes, partitionId,
    producerHash: semanticHash('semantic.cfg-producer.v1', { version: Number(SEMANTIC_ANALYSIS_VERSIONS.cfgFlow) }), contextHash: context.contextKey,
    policyHash: semanticHash('semantic.cfg-policy.v1', { maxSccIterations: policy.enrichment.maxSccIterations, fieldPathDepth: policy.enrichment.fieldPathDepth }), diskAccount, signal });
  return { partition, coverage: [coverage], edges: unique.map(([, row]) => row), fieldAccesses, aliases, callEffects: expand(callEffects), summaries: summaries.map(summary => ({ ...summary, returns: expand(summary.returns), exceptions: expand(summary.exceptions), effects: expand(summary.effects), parameterFields: expand(summary.parameterFields) })) };
};
