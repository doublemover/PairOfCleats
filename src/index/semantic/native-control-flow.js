import { nativeChildren, nativeFunctionKinds, nativeTransfer } from './native-syntax.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from './analysis-versions.js';
import { createAnalysisPartitionId, semanticHash } from './identity.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { throwIfAborted } from '../../shared/abort.js';

const containers = new Set(['module', 'translation_unit', 'source_file', 'block', 'compound_statement', 'function_body', 'statements', 'else_clause']);
const branches = new Set(['if_statement', 'if_expression', 'elif_clause']);
const loops = new Set(['for_statement', 'for_expression', 'while_statement', 'while_expression', 'loop_expression', 'do_statement', 'repeat_while_statement']);
const unsupported = /try|catch|finally|except|with_statement|defer|guard_statement|switch|match_expression|labeled_statement|goto|yield|await|macro|preproc|unsafe/;
const child = (node, name) => node.childForFieldName(name);

/** Structured statement CFG only. Grammar evidence does not establish compiler
 * value/alias flow or runtime dispatch; those limits remain explicit coverage.
 */
export const collectNativeControlFlow = async ({ syntax, collector, partition, source, bytes, root, policy, diskAccount, signal }) => {
  const mode = policy.enrichment.localFlow;
  const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'localFlow',
    state: mode === 'off' ? 'disabled' : 'unsupported', reason: mode === 'off' ? 'analysis_policy_disabled' : 'native_flow_requires_eager_admission',
    observedCount: null, completedCount: 0, frontierRef: null };
  if (mode !== 'eager' || !syntax?.tree || !collector.owners.length) return { coverage, partition: null };
  const version = SEMANTIC_ANALYSIS_VERSIONS.nativeFlow;
  const partitionId = createAnalysisPartitionId({ pass: { name: 'native-structured-control', version },
    inputPartitionHashes: [partition.canonicalHash], compilerContext: null, dependencySummaryHashes: [], analysisPolicy: policy.identity.analysis });
  const rows = [], reasons = new Set(['compiler_value_and_alias_flow_unavailable', 'runtime_dispatch_and_exception_behavior_unknown']);
  const ref = localId => ({ partitionId, localId });
  let nextId = 0, edgeId = 0;
  const evidence = ref(nextId++);
  rows.push({ family: 'node', row: { id: evidence.localId, kind: 'evidence', span: null, scope: null,
    data: { method: 'native-grammar-structured-control', producerId: 'native-flow:' + source.language,
      producerVersion: version, evidenceKind: 'static-analysis', sourceRef: source.sourceUnitId, artifactRef: null } } });
  const anchor = node => node ? collector.anchors.get(node.id) : null;
  const edge = (kind, from, to, condition = null) => {
    if (from && to) rows.push({ family: 'edge', row: { id: edgeId++, kind, from, to, callSite: null,
      operandOrdinal: null, contextKey: null, condition, evidence, certainty: 'modeled' } });
  };
  let blockCount = 0;
  for (const owner of collector.owners) {
    throwIfAborted(signal);
    const ownerRef = anchor(owner);
    const block = (node, blockKind = 'normal') => {
      const result = ref(nextId++); blockCount += 1;
      rows.push({ family: 'node', row: { id: result.localId, kind: 'block', span: node ? [node.startIndex, node.endIndex] : null,
        scope: null, data: { owner: ownerRef, blockKind } } });
      if (anchor(node)) edge('evidenceInput', result, anchor(node));
      return result;
    };
    const exit = block(null, 'exit'), exception = block(null, 'exception');
    const event = (node, next, context) => {
      const current = block(node); edge('controlNext', current, next);
      // These are possible effects, not a claim that a statement actually throws.
      edge('exceptional', current, context.exception);
      return current;
    };
    const compile = (node, next, context, depth = 0) => {
      throwIfAborted(signal);
      if (!node) return next;
      if (depth > 192) { reasons.add('native_control_depth_limit'); return event(node, next, context); }
      const kind = node.type;
      if (kind === 'comment') return next;
      if (nativeFunctionKinds.has(kind) && node.id !== owner.id) { reasons.add('declaration_initializers_and_closure_activation_unknown'); return event(node, next, context); }
      if (unsupported.test(kind) || node.hasError) {
        reasons.add('unsupported_control:' + kind);
        return event(node, next, context);
      }
      const recurse = (value, continuation = next, currentContext = context) => compile(value, continuation, currentContext, depth + 1);
      if (containers.has(kind)) {
        let continuation = next;
        const children = nativeChildren(node);
        for (let i = children.length - 1; i >= 0; i--) continuation = recurse(children[i], continuation);
        return continuation;
      }
      if (kind === 'expression_statement' && node.namedChildCount === 1) return recurse(node.namedChild(0));
      const transfer = nativeTransfer(node);
      if (transfer) {
        const current = block(node);
        if (transfer === 'return') {
          edge('controlNext', current, context.exit);
          const value = child(node, 'result') || nativeChildren(node)[0];
          edge('returns', anchor(value), context.exit);
          edge('exceptional', current, context.exception);
        } else if (transfer === 'throw') edge('exceptional', current, context.exception);
        else {
          const target = context[transfer];
          if (target) edge('controlNext', current, target);
          else { reasons.add('unresolved_control_transfer:' + transfer); edge('controlNext', current, next); }
          if (node.namedChildCount) reasons.add('labeled_or_value_transfer_unknown');
        }
        return current;
      }
      if (branches.has(kind)) {
        const named = nativeChildren(node), condition = child(node, 'condition');
        const consequence = child(node, 'consequence') || named.find(value => value.type === 'statements');
        let alternative = next;
        const alternatives = named.filter(value => ['elif_clause', 'else_clause'].includes(value.type)
          || value.id !== consequence?.id && ['statements', 'if_statement'].includes(value.type));
        const direct = child(node, 'alternative');
        if (direct && !alternatives.some(value => value.id === direct.id)) alternatives.push(direct);
        for (let i = alternatives.length - 1; i >= 0; i--) alternative = recurse(alternatives[i], alternative);
        const branch = block(condition || node);
        edge('controlTrue', branch, recurse(consequence), anchor(condition));
        edge('controlFalse', branch, alternative, anchor(condition));
        edge('exceptional', branch, context.exception);
        if (!condition || !consequence) reasons.add('native_condition_shape_unknown:' + kind);
        return branch;
      }
      if (loops.has(kind)) {
        const named = nativeChildren(node), body = child(node, 'body') || named.find(value => value.type === 'statements');
        const condition = child(node, 'condition') || child(node, 'right') || child(node, 'collection') || child(node, 'value');
        const test = block(condition || node), update = child(node, 'update');
        const again = update ? recurse(update, test) : test;
        const loopContext = { ...context, break: next, continue: again };
        const start = recurse(body, again, loopContext);
        edge(condition ? 'controlTrue' : 'controlNext', test, start, anchor(condition));
        if (condition) edge('controlFalse', test, recurse(child(node, 'alternative')), anchor(condition));
        edge('exceptional', test, context.exception);
        if (!body) reasons.add('native_loop_body_unknown:' + kind);
        const first = ['do_statement', 'repeat_while_statement'].includes(kind) ? start : test;
        return recurse(child(node, 'initializer'), first);
      }
      return event(node, next, context);
    };
    const body = nativeFunctionKinds.has(owner.type) ? child(owner, 'body') : owner;
    const context = { exit, exception, break: null, continue: null };
    const first = compile(body, exit, context);
    const entry = block(owner, 'entry'); edge('controlNext', entry, first);
    if (!body) reasons.add('native_function_body_unknown:' + owner.type);
    if (source.language === 'rust') reasons.add('implicit_tail_and_drop_value_flow_unavailable');
  }
  Object.assign(coverage, { state: 'partial', reason: [...reasons].sort().join(';'), observedCount: blockCount, completedCount: blockCount });
  rows.push({ family: 'coverage', row: coverage });
  const result = await writeSemanticAnalysis({ rows, source, sourceBytes: bytes, stagingRoot: root, partitionId,
    producerHash: semanticHash('semantic.native-control-producer.v1', { version, language: source.language }),
    contextHash: null, policyHash: policy.identity.analysis, diskAccount, policy, signal });
  return { partition: result, coverage };
};
