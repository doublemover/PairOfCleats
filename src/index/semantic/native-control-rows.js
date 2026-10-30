import { nativeFunctionKinds, nativeTransfer } from './native-syntax.js';

const containers = new Set(['module', 'translation_unit', 'source_file', 'block', 'compound_statement', 'function_body', 'statements', 'else_clause']);
const branches = new Set(['if_statement', 'if_expression', 'elif_clause']);
const loops = new Set(['for_statement', 'for_expression', 'while_statement', 'while_expression', 'loop_expression', 'do_statement', 'repeat_while_statement']);
const unsupported = /try|catch|finally|except|with_statement|defer|guard_statement|switch|match_expression|labeled_statement|goto|yield|await|macro|preproc|unsafe/;
const child = (node, name) => node.childForFieldName(name);

/** Deterministic pull producer. A paused yield constructs no later row. The
 * existing sink permits forward local references and checks them at finalization.
 * Width never creates a child/alternative array; depth retains bounded frames.
 */
export function* nativeControlRows({ collector, partitionId, source, version, coverage, construction }) {
  const { check, reason } = construction;
  const emit = factory => construction.emit(factory), ref = localId => ({ partitionId, localId });
  const anchor = node => node ? collector.anchors.get(node.id) : null;
  const firstNamed = (node, predicate) => {
    for (let index = 0; index < node.namedChildCount; index++) {
      check(); const value = node.namedChild(index); if (predicate(value)) return value;
    }
    return null;
  };
  const transferFor = node => {
    if (node.type !== 'control_transfer_statement') return nativeTransfer(node);
    for (let index = 0; index < node.childCount; index++) {
      check(); const kind = node.child(index).type;
      if (['return', 'throw', 'break', 'continue'].includes(kind)) return kind;
    }
    return null;
  };
  let nextId = 0, edgeId = 0, blockCount = 0;
  const evidence = ref(nextId++);
  reason('compiler_value_and_alias_flow_unavailable'); reason('runtime_dispatch_and_exception_behavior_unknown');
  yield* emit(() => ({ family: 'node', row: { id: evidence.localId, kind: 'evidence', span: null, scope: null,
    data: { method: 'native-grammar-structured-control', producerId: 'native-flow:' + source.language,
      producerVersion: version, evidenceKind: 'static-analysis', sourceRef: source.sourceUnitId, artifactRef: null } } }));
  function* edge(kind, from, to, condition = null) {
    if (from && to) yield* emit(() => ({ family: 'edge', row: { id: edgeId++, kind, from, to, callSite: null,
      operandOrdinal: null, contextKey: null, condition, evidence, certainty: 'modeled' } }));
  }
  for (const owner of collector.owners) {
    check();
    const ownerRef = anchor(owner);
    function* block(node, blockKind = 'normal') {
      const result = ref(nextId++); blockCount++;
      yield* emit(() => ({ family: 'node', row: { id: result.localId, kind: 'block', span: node ? [node.startIndex, node.endIndex] : null,
        scope: null, data: { owner: ownerRef, blockKind } } }));
      if (anchor(node)) yield* edge('evidenceInput', result, anchor(node));
      return result;
    }
    function* event(node, next, context) {
      const current = yield* block(node);
      yield* edge('controlNext', current, next);
      yield* edge('exceptional', current, context.exception);
      return current;
    }
    function* compile(node, next, context, depth = 0) {
      check(); if (!node) return next;
      const release = construction.enterFrame();
      try {
        if (depth > 192) { reason('native_control_depth_limit'); return yield* event(node, next, context); }
        const kind = node.type;
        if (kind === 'comment') return next;
        if (nativeFunctionKinds.has(kind) && node.id !== owner.id) {
          reason('declaration_initializers_and_closure_activation_unknown'); return yield* event(node, next, context);
        }
        if (unsupported.test(kind) || node.hasError) {
          reason('unsupported_control:' + kind); return yield* event(node, next, context);
        }
        const recurse = (value, continuation = next, currentContext = context) => compile(value, continuation, currentContext, depth + 1);
        if (containers.has(kind)) {
          let continuation = next;
          for (let index = node.namedChildCount - 1; index >= 0; index--) { check(); continuation = yield* recurse(node.namedChild(index), continuation); }
          return continuation;
        }
        if (kind === 'expression_statement' && node.namedChildCount === 1) return yield* recurse(node.namedChild(0));
        const transfer = transferFor(node);
        if (transfer) {
          const current = yield* block(node);
          if (transfer === 'return') {
            yield* edge('controlNext', current, context.exit);
            const value = child(node, 'result') || (node.namedChildCount ? node.namedChild(0) : null);
            yield* edge('returns', anchor(value), context.exit);
            yield* edge('exceptional', current, context.exception);
          } else if (transfer === 'throw') yield* edge('exceptional', current, context.exception);
          else {
            const target = context[transfer];
            if (target) yield* edge('controlNext', current, target);
            else { reason('unresolved_control_transfer:' + transfer); yield* edge('controlNext', current, next); }
            if (node.namedChildCount) reason('labeled_or_value_transfer_unknown');
          }
          return current;
        }
        if (branches.has(kind)) {
          const condition = child(node, 'condition');
          const consequence = child(node, 'consequence') || firstNamed(node, value => value.type === 'statements');
          let alternative = next;
          const isAlternative = value => ['elif_clause', 'else_clause'].includes(value.type)
            || value.id !== consequence?.id && ['statements', 'if_statement'].includes(value.type);
          const direct = child(node, 'alternative');
          if (direct && !firstNamed(node, value => value.id === direct.id && isAlternative(value))) alternative = yield* recurse(direct, alternative);
          for (let index = node.namedChildCount - 1; index >= 0; index--) {
            check(); const value = node.namedChild(index);
            if (isAlternative(value)) alternative = yield* recurse(value, alternative);
          }
          const branch = yield* block(condition || node);
          const consequent = yield* recurse(consequence);
          yield* edge('controlTrue', branch, consequent, anchor(condition));
          yield* edge('controlFalse', branch, alternative, anchor(condition));
          yield* edge('exceptional', branch, context.exception);
          if (!condition || !consequence) reason('native_condition_shape_unknown:' + kind);
          return branch;
        }
        if (loops.has(kind)) {
          const body = child(node, 'body') || firstNamed(node, value => value.type === 'statements');
          const condition = child(node, 'condition') || child(node, 'right') || child(node, 'collection') || child(node, 'value');
          const test = yield* block(condition || node), update = child(node, 'update');
          const again = update ? yield* recurse(update, test) : test;
          const loopContext = { ...context, break: next, continue: again };
          const start = yield* recurse(body, again, loopContext);
          yield* edge(condition ? 'controlTrue' : 'controlNext', test, start, anchor(condition));
          if (condition) {
            const alternative = yield* recurse(child(node, 'alternative'));
            yield* edge('controlFalse', test, alternative, anchor(condition));
          }
          yield* edge('exceptional', test, context.exception);
          if (!body) reason('native_loop_body_unknown:' + kind);
          const first = ['do_statement', 'repeat_while_statement'].includes(kind) ? start : test;
          return yield* recurse(child(node, 'initializer'), first);
        }
        return yield* event(node, next, context);
      } finally { release(); }
    }
    const exit = yield* block(null, 'exit'), exception = yield* block(null, 'exception');
    const body = nativeFunctionKinds.has(owner.type) ? child(owner, 'body') : owner;
    const first = yield* compile(body, exit, { exit, exception, break: null, continue: null });
    const entry = yield* block(owner, 'entry'); yield* edge('controlNext', entry, first);
    if (!body) reason('native_function_body_unknown:' + owner.type);
    if (source.language === 'rust') reason('implicit_tail_and_drop_value_flow_unavailable');
  }
  Object.assign(coverage, { state: 'partial', reason: [...construction.reasons].sort().join(';'), observedCount: blockCount, completedCount: blockCount });
  yield* emit(() => ({ family: 'coverage', row: coverage }));
}
