import { buildCompilerFlowGraph } from './compiler-flow-graph.js';
import { createAnalysisPartitionId, semanticHash, canonicalSemanticJson } from './identity.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { throwIfAborted } from '../../shared/abort.js';
/** Source-owned definition versions plus monotone reaching-definition joins. */
export const collectCompilerFlow = async ({ ts, checker, sourceFile, nodes, expressionFor, declarationFor,
  source, bytes, bindingPartition, context, root, policy, diskAccount, signal }) => {
  if (['off', 'deferred'].includes(policy.enrichment.localFlow)) return null;
  const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-cfg-flow', version: '1' },
    inputPartitionHashes: [bindingPartition.canonicalHash], compilerContext: context, dependencySummaryHashes: [],
    analysisPolicy: { maxSccIterations: policy.enrichment.maxSccIterations, version: 1 } });
  const local = key => ({ local: key }), ledger = new Map(), edges = [], operands = [], reasons = new Set(), summaries = [];
  const add = (key, kind, node, data) => {
    if (!ledger.has(key)) ledger.set(key, { kind, span: node ? [node.getStart(sourceFile), node.end] : null, scope: null, data });
    return local(key);
  };
  const evidence = add('evidence', 'evidence', null, { method: 'structured-cfg-reaching-definitions', producerId: 'semantic-flow',
    producerVersion: '1', evidenceKind: 'static-analysis', sourceRef: source.sourceUnitId, artifactRef: null });
  const edge = (kind, from, to, condition = null, certainty = 'exact-static') => {
    if (from && to) edges.push({ kind, from, to, callSite: null, operandOrdinal: null, contextKey: context.contextKey, condition, evidence, certainty });
  };
  const owners = [sourceFile, ...[...nodes].filter(node => ts.isFunctionLike(node) && node.body)];
  let totalBlocks = 0, solvedBlocks = 0;
  for (const owner of owners) {
    throwIfAborted(signal);
    const ownerRef = expressionFor(owner);
    if (!ownerRef) { reasons.add('missing_function_syntax_anchor'); continue; }
    const prefix = owner.getStart(sourceFile) + ':' + owner.end + ':' + ts.SyntaxKind[owner.kind];
    const graph = buildCompilerFlowGraph({ ts, owner, sourceFile, expressionFor, signal });
    for (const reason of graph.reasons) reasons.add(reason);
    const reachable = new Set(), pending = [graph.entry], predecessors = new Map();
    while (pending.length) {
      const block = pending.pop(); if (reachable.has(block)) continue; reachable.add(block);
      for (const successor of block.successors) { if (!predecessors.has(successor.to)) predecessors.set(successor.to, []); predecessors.get(successor.to).push(block); pending.push(successor.to); }
    }
    const symbols = new Map(), blockRefs = new Map(), writes = new Map();
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
      const symbol = symbolFor(block.event?.target);
      if (symbol) block.symbol = symbol;
      if (block.event?.kind === 'write' && symbol) {
        const value = add('write:' + prefix + ':' + block.key, 'value', block.event.target,
          { origin: block.event.origin, site: expressionFor(block.event.value) || block.site, storage: null });
        writes.set(block, value);
        edge('defines', block.event.origin === 'parameter' ? declarationFor(block.event.target.parent) : expressionFor(block.event.value), value);
        edge('writes', value, expressionFor(block.event.target));
      }
    }
    for (const [symbol, entry] of symbols) entry.unknown = add('unknown:' + prefix + ':' + entry.key, 'value', null,
      { origin: 'unknown', site: entry.site, storage: null });
    const initial = new Map([...symbols].map(([symbol, entry]) => [symbol, new Set([entry.unknown.local])]));
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
      if (!equal(outgoing.get(block), output)) {
        outgoing.set(block, output);
        for (const successor of block.successors) if (!queued.has(successor.to)) { queue.push(successor.to); queued.add(successor.to); }
      }
    }
    const complete = index === queue.length;
    if (!complete) reasons.add('reaching_definition_iteration_budget');
    totalBlocks += reachable.size; solvedBlocks += complete ? reachable.size : outgoing.size;
    const returnRefs = [];
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
        edge('reads', value, expressionFor(event.target), null, values.size > 1 || !complete ? 'modeled' : 'exact-static');
      }
      if (event?.kind === 'return' && event.value) {
        const value = add('return:' + prefix + ':' + block.key, 'value', block.node,
          { origin: 'return', site: expressionFor(event.value) || block.site, storage: null });
        edge('returns', expressionFor(event.value), value); returnRefs.push(value);
      }
      if (event?.kind === 'throw' && event.value) edge('throws', expressionFor(event.value), blockRefs.get(graph.exception));
      if (event?.kind === 'operation') {
        const node = block.node;
        if (ts.isBinaryExpression(node)) {
          edge('flowsTo', expressionFor(node.left), block.site); edge('flowsTo', expressionFor(node.right), block.site);
        } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) edge('flowsTo', expressionFor(node.operand), block.site);
        else if (ts.isConditionalExpression(node)) {
          edge('flowsTo', expressionFor(node.whenTrue), block.site, expressionFor(node.condition), 'modeled');
          edge('flowsTo', expressionFor(node.whenFalse), block.site, expressionFor(node.condition), 'modeled');
        }
      }
    }
    summaries.push({ owner, ownerRef, declaration: owner.parent && ts.isVariableDeclaration(owner.parent) && owner.parent.initializer === owner ? declarationFor(owner.parent) : declarationFor(owner), returns: returnRefs,
      parameters: (owner.parameters || []).map(parameter => declarationFor(parameter)), complete: complete && graph.reasons.size === 0 });
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
  const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'localFlow', state: reasons.size ? 'partial' : 'complete',
    reason: reasons.size ? [...reasons].sort().join(';') : null, observedCount: totalBlocks, completedCount: solvedBlocks, frontierRef: null };
  rows.push({ family: 'coverage', row: coverage });
  const partition = await writeSemanticAnalysis({ rows, policy, stagingRoot: root, source, sourceBytes: bytes, partitionId,
    producerHash: semanticHash('semantic.cfg-producer.v1', { version: 1 }), contextHash: context.contextKey,
    policyHash: semanticHash('semantic.cfg-policy.v1', { maxSccIterations: policy.enrichment.maxSccIterations }), diskAccount, signal });
  return { partition, coverage: [coverage], summaries: summaries.map(summary => ({ ...summary, returns: summary.returns.map(expand) })) };
};
