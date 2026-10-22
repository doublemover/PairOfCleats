import { throwIfAborted } from '../../shared/abort.js';
import { compilerOperationDependencies } from './compiler-operation-dependencies.js';
import { unwrapCompilerExpression } from './compiler-property-paths.js';
/** Structured intraprocedural CFG. Nodes are syntax anchors, not runtime executions. */
export const buildCompilerFlowGraph = ({ ts, owner, sourceFile, expressionFor, signal, constructionLimits = null }) => {
  const blocks = [], reasons = new Set();
  const maxBytes = Math.max(1, constructionLimits?.maxBytes ?? 16 * 1024 * 1024);
  const maxBlocks = Math.max(1, constructionLimits?.maxBlocks ?? Math.min(32768, Math.floor(maxBytes / 512)));
  const maxWork = Math.max(1, constructionLimits?.maxWork ?? maxBlocks * 32);
  const constructionStop = new Error('Compiler CFG construction budget exhausted.');
  const stats = { createdBlocks: 0, constructionWork: 0, admittedBytes: 0, finalizerVariants: 0, finalizerMemoHits: 0 };
  const admit = (bytes = 0) => {
    throwIfAborted(signal);
    stats.constructionWork++; stats.admittedBytes += bytes;
    if (stats.constructionWork > maxWork || stats.admittedBytes > maxBytes) throw constructionStop;
  };
  let sequence = 0;
  const add = (node, event = null, kind = 'normal') => {
    admit(512);
    if (blocks.length >= maxBlocks) throw constructionStop;
    const block = { key: String(sequence++).padStart(10, '0'), node, site: expressionFor(node) || expressionFor(owner), event, kind, successors: [] };
    blocks.push(block); stats.createdBlocks++; return block;
  };
  const link = (from, to, kind = 'controlNext', condition = null) => { if (to) { admit(48); from.successors.push({ to, kind, condition }); } };
  // Terminals are always available; budgets apply before the first source node.
  const terminal = kind => ({ key: String(sequence++).padStart(10, '0'), node: owner, site: expressionFor(owner), event: null, kind, successors: [] });
  const exit = terminal('exit'), exception = terminal('exception');
  blocks.push(exit, exception); stats.createdBlocks = 2;
  const finalizerMemo = new WeakMap(), abruptMemo = new WeakMap();
  const abruptKinds = root => {
    if (!root) return new Set();
    if (abruptMemo.has(root)) return abruptMemo.get(root);
    const kinds = new Set(), pending = [root];
    while (pending.length) {
      admit();
      const node = pending.pop();
      if (ts.isFunctionLike(node)) continue;
      if (ts.isReturnStatement(node)) kinds.add('return');
      if (ts.isBreakStatement(node)) kinds.add('break');
      if (ts.isContinueStatement(node)) kinds.add('continue');
      ts.forEachChild(node, child => { pending.push(child); });
    }
    abruptMemo.set(root, kinds); return kinds;
  };
  const finalizer = (node, target, context) => {
    if (!node) return target;
    let memo = finalizerMemo.get(node);
    if (!memo) { memo = new Map(); finalizerMemo.set(node, memo); }
    const key = JSON.stringify([target?.key, context.return?.key, context.exception?.key, context.break?.key, context.continue?.key,
      [...context.labels].map(([name, destinations]) => [name, destinations.break?.key, destinations.continue?.key]), context.iterationLabels]);
    if (memo.has(key)) { stats.finalizerMemoHits++; return memo.get(key); }
    admit(Buffer.byteLength(key) + 64); stats.finalizerVariants++;
    const entry = statement(node, target, context);
    memo.set(key, entry); return entry;
  };
  const anchor = node => expressionFor(node) || null;
  const children = node => { const result = []; ts.forEachChild(node, child => { result.push(child); }); return result; };
  const lexicalRead = node => {
    const parent = node.parent;
    if (!parent) return true;
    if ((ts.isPropertyAccessExpression(parent) && parent.name === node)
      || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node)
      || ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionLike(parent)) && parent.name === node)
      || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isBindingElement(parent)) return false;
    return true;
  };
  const eventBlock = (node, event, next, context) => {
    const block = add(node, event); link(block, next);
    if (event?.mayThrow) link(block, context.exception, 'exceptional');
    return block;
  };
  const referenceTarget = node => unwrapCompilerExpression(ts, node);
  const write = (target, value, next, context, origin = 'definition') => {
    target = referenceTarget(target);
    if (ts.isIdentifier(target)) return eventBlock(target, { kind: 'write', target, value, origin }, next, context);
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) return eventBlock(target, { kind: 'heapWrite', target, value, origin, mayThrow: true }, next, context);
    reasons.add('destructuring_write_requires_pattern_analysis');
    return expression(target, eventBlock(target, { kind: 'unknownWrite', target, value }, next, context), context);
  };
  const isChain = node => node && (ts.isCallChain(node) || ts.isPropertyAccessChain(node) || ts.isElementAccessChain(node));
  // A nullish hop skips the entire contiguous optional-chain region, including
  // later computed keys and call arguments. Parentheses end that region.
  const optionalChain = (node, next, context, shortCircuit, asReference = false) => {
    throwIfAborted(signal);
    const call = ts.isCallExpression(node);
    let active = asReference && !call ? next
      : eventBlock(node, { kind: call ? 'operation' : 'heapRead', target: node, mayThrow: true }, next, context);
    const evaluated = call ? [...node.arguments] : ts.isElementAccessExpression(node) ? [node.argumentExpression] : [];
    for (let i = evaluated.length - 1; i >= 0; i -= 1) active = expression(evaluated[i], active, context);
    if (call) reasons.add('call_heap_and_captured_effects_unresolved');
    if (node.questionDotToken) {
      const branch = add(node.expression, { kind: 'condition', predicate: { operation: 'isNullish', inputs: [node.expression] } });
      link(branch, shortCircuit, 'controlTrue'); link(branch, active, 'controlFalse');
      active = branch;
    }
    return isChain(node.expression) ? optionalChain(node.expression, active, context, shortCircuit)
      : expression(node.expression, active, context);
  };
  // Reference evaluation resolves only the selected location. Its receiver and
  // key still produce values, but the selected property's GetValue is omitted.
  const reference = (input, next, context, shortCircuit = next) => {
    const node = referenceTarget(input);
    if (!node || ts.isIdentifier(node)) return next;
    if (isChain(node)) return optionalChain(node, next, context, shortCircuit, true);
    if (ts.isPropertyAccessExpression(node)) return expression(node.expression, next, context);
    if (ts.isElementAccessExpression(node)) return expression(node.expression,
      expression(node.argumentExpression, next, context), context);
    return expression(node, next, context);
  };
  const expression = (node, next, context) => {
    if (!node) return next;
    admit();
    if (ts.isClassExpression(node)) return classDefinition(node, next, context);
    if (ts.isComputedPropertyName(node)) {
      // PropertyName evaluation includes ToPropertyKey before the initializer
      // or function creation, and conversion can invoke user code or throw.
      return expression(node.expression, eventBlock(node, {
        kind: 'operation', target: node, mayThrow: true
      }, next, context), context);
    }
    if (ts.isFunctionLike(node)) {
      const creation=eventBlock(node,{kind:'creation'},next,context);
      if(ts.isObjectLiteralExpression(node.parent) && node.name && ts.isComputedPropertyName(node.name)) {
        return expression(node.name,creation,context);
      }
      return creation;
    }
    if (ts.isIdentifier(node)) return lexicalRead(node) ? eventBlock(node, { kind: 'read', target: node }, next, context) : next;
    if (ts.isDeleteExpression(node)) {
      const target = referenceTarget(node.expression);
      const deletion = eventBlock(node, { kind: 'operation', target: node,
        mayThrow: ts.isIdentifier(target) || ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)
      }, next, context);
      const skipped = isChain(target) ? eventBlock(node, { kind: 'operation', target: node, mayThrow: false }, next, context) : next;
      return reference(target, deletion, context, skipped);
    }
    if (isChain(node)) return optionalChain(node, next, context, next);
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      const assignment = operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment;
      const logical = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(operator);
      if (logical) {
        const join = eventBlock(node, { kind: 'operation' }, next, context), branch = add(node.left, { kind: 'condition' });
        const right = expression(node.right, assignment ? write(node.left, node, join, context) : join, context);
        const reversed = [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.BarBarEqualsToken].includes(operator);
        link(branch, reversed ? join : right, 'controlTrue', anchor(node.left));
        link(branch, reversed ? right : join, 'controlFalse', anchor(node.left));
        if ([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(operator)) branch.event.predicate = { operation: 'isNullish', inputs: [node.left] };
        return expression(node.left, branch, context);
      }
      if (assignment) {
        const value = operator === ts.SyntaxKind.EqualsToken ? node.right : node;
        const written = write(node.left, value, next, context);
        const operation = eventBlock(node, { kind: 'operation', mayThrow: operator !== ts.SyntaxKind.EqualsToken }, written, context);
        const rhs = expression(node.right, operation, context);
        if (operator === ts.SyntaxKind.EqualsToken) return reference(node.left, rhs, context);
        return expression(node.left, rhs, context);
      }
    }
    if (ts.isConditionalExpression(node)) {
      const join = eventBlock(node, { kind: 'operation' }, next, context), branch = add(node.condition, { kind: 'condition' });
      link(branch, expression(node.whenTrue, join, context), 'controlTrue', anchor(node.condition));
      link(branch, expression(node.whenFalse, join, context), 'controlFalse', anchor(node.condition));
      return expression(node.condition, branch, context);
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
      return expression(node.operand, eventBlock(node, { kind: 'operation', mayThrow: true }, write(node.operand, node, next, context), context), context);
    }
    const mayThrow = ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node) || ts.isNewExpression(node) || ts.isPropertyAccessExpression(node)
      || ts.isElementAccessExpression(node) || ts.isAwaitExpression(node) || ts.isBinaryExpression(node)
      || ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) || compilerOperationDependencies(ts, node)?.mayThrow;
    if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) reasons.add('call_heap_and_captured_effects_unresolved');
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) reasons.add('suspension_shared_effects_unresolved');
    if (node.questionDotToken) reasons.add('optional_guard_effects_conservative');
    let head = eventBlock(node, { kind: ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? 'heapRead' : 'operation', target: node, mayThrow }, next, context);
    // Compiler child order preserves ordinary expression evaluation; type nodes are not evaluated.
    const parts = children(node).filter(child => !ts.isTypeNode(child));
    for (let i = parts.length - 1; i >= 0; i -= 1) head = expression(parts[i], head, context);
    return head;
  };
  const list = (items, next, context) => {
    let head = next;
    for (let i = items.length - 1; i >= 0; i -= 1) head = statement(items[i], head, context);
    return head;
  };
  const declarations = (node, next, context) => {
    let head = next;
    for (let i = node.declarations.length - 1; i >= 0; i -= 1) {
      const declaration = node.declarations[i];
      if(!declaration.initializer && !(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
        // var introduces/hoists a binding; this statement performs no runtime
        // assignment. Keep reaching parameter/initializer values intact.
        reasons.add('var_hoisted_undefined_conservative');
        continue;
      }
      head = expression(declaration.initializer, write(declaration.name, declaration.initializer || declaration, head, context), context);
    }
    return head;
  };
  const hasModifier = (node, kind) => node.modifiers?.some(modifier => modifier.kind === kind);
  const classDefinition = (node, next, context) => {
    if (sourceFile.isDeclarationFile || (node.flags & ts.NodeFlags.Ambient)
      || hasModifier(node, ts.SyntaxKind.DeclareKeyword)) return next;
    // ClassDefinitionEvaluation first evaluates heritage and all computed keys,
    // then executes static fields/blocks in source order. Instance initializers
    // and method bodies belong to later executions, never this definition CFG.
    // https://tc39.es/ecma262/#sec-runtime-semantics-classdefinitionevaluation
    reasons.add('class_storage_private_and_self_binding_effects_unresolved');
    const members = node.members.filter(member => !hasModifier(member, ts.SyntaxKind.DeclareKeyword)
      && !hasModifier(member, ts.SyntaxKind.AbstractKeyword));
    if ([node, ...node.members].some(item => ts.canHaveDecorators(item) && ts.getDecorators(item)?.length)) {
      reasons.add('class_decorator_evaluation_and_replacement_unresolved');
    }
    let head = next;
    for (let i = members.length - 1; i >= 0; i -= 1) {
      const member = members[i];
      if (ts.isClassStaticBlockDeclaration(member)) {
        head = statement(member.body, head, { ...context, break: null, continue: null, labels: new Map() });
      } else if (ts.isPropertyDeclaration(member) && hasModifier(member, ts.SyntaxKind.StaticKeyword)) {
        head = expression(member.initializer, eventBlock(member, {
          kind: 'operation', target: member, mayThrow: true
        }, head, context), context);
      }
    }
    for (let i = members.length - 1; i >= 0; i -= 1) {
      const name = members[i].name;
      if (name && ts.isComputedPropertyName(name)) {
        head = expression(name, head, context);
      }
    }
    head = eventBlock(node, { kind: 'creation', mayThrow: true }, head, context);
    const heritage = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    return expression(heritage?.expression, head, context);
  };
  const statement = (node, next, context) => {
    admit();
    if (!node) return next;
    if (ts.isBlock(node) || ts.isSourceFile(node)) return list(node.statements, next, context);
    if (ts.isVariableStatement(node)) return declarations(node.declarationList, next, context);
    if (ts.isExpressionStatement(node)) return expression(node.expression, next, context);
    if (ts.isIfStatement(node)) {
      const branch = add(node.expression, { kind: 'condition' });
      link(branch, statement(node.thenStatement, next, context), 'controlTrue', anchor(node.expression));
      link(branch, node.elseStatement ? statement(node.elseStatement, next, context) : next, 'controlFalse', anchor(node.expression));
      return expression(node.expression, branch, context);
    }
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
      const block = add(node, { kind: ts.isReturnStatement(node) ? 'return' : 'throw', value: node.expression });
      link(block, ts.isReturnStatement(node) ? context.return : context.exception, ts.isReturnStatement(node) ? 'controlNext' : 'exceptional');
      return expression(node.expression, block, context);
    }
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
      const isBreak = ts.isBreakStatement(node), label = node.label?.text;
      const target = label ? context.labels.get(label)?.[isBreak ? 'break' : 'continue'] : context[isBreak ? 'break' : 'continue'];
      const block = add(node, { kind: 'abrupt' });
      if (!target) reasons.add('unresolved_abrupt_target');
      link(block, target || exception); return block;
    }
    if (ts.isLabeledStatement(node)) {
      const labels=new Map(context.labels), iterationLabels=[];
      let body=node;
      while(ts.isLabeledStatement(body)) {
        const name=body.label.text;labels.set(name,{break:next,continue:null});iterationLabels.push(name);body=body.statement;
      }
      const iteration=ts.isWhileStatement(body) || ts.isDoStatement(body) || ts.isForStatement(body)
        || ts.isForOfStatement(body) || ts.isForInStatement(body);
      return statement(body,next,{...context,labels,iterationLabels:iteration ? iterationLabels : []});
    }
    if (ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForStatement(node)
      || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const iteration = ts.isForOfStatement(node) || ts.isForInStatement(node);
      const condition = node.condition || node.expression, branch = add(condition || node, { kind: 'condition',
        ...(iteration ? { mayThrow: true, predicate: { operation: ts.isForOfStatement(node) ? 'iteratorHasNext' : 'enumeratorHasNext', inputs: [node.expression] } } : {}) });
      if (iteration) link(branch, context.exception, 'exceptional');
      let test = iteration ? branch : expression(condition, branch, context);
      let step = ts.isForStatement(node) ? expression(node.incrementor, test, context) : test;
      const labels = new Map(context.labels);
      for(const label of context.iterationLabels || []) labels.set(label,{break:next,continue:step});
      const bodyContext = { ...context, break: next, continue: step, labels, iterationLabels: [] };
      let body = statement(node.statement, step, bodyContext);
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        reasons.add('iterator_protocol_and_per_iteration_binding_conservative');
        const binding = ts.isVariableDeclarationList(node.initializer) ? node.initializer.declarations[0]?.name : node.initializer;
        // The iterable is not the yielded element/key. Keep that value unknown
        // until an iterator model supplies a source-qualified producer.
        if (binding) {
          const assigned = write(binding, node, body, bodyContext, 'unknown'), target = referenceTarget(binding);
          // A property LHS is evaluated for each produced element/key before
          // assigning it. The iterable is evaluated only at the loop entry.
          body = ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)
            ? reference(target, assigned, bodyContext) : assigned;
        }
      }
      link(branch, body, 'controlTrue', anchor(condition));
      if (condition || !ts.isForStatement(node)) link(branch, next, 'controlFalse', anchor(condition));
      if (ts.isDoStatement(node)) return body;
      if (iteration) return expression(node.expression, test, context);
      if (ts.isForStatement(node) && node.initializer) test = ts.isVariableDeclarationList(node.initializer)
        ? declarations(node.initializer, test, context) : expression(node.initializer, test, context);
      return test;
    }
    if (ts.isSwitchStatement(node)) {
      let fallthrough = next;
      const clauses = [];
      for (let i = node.caseBlock.clauses.length - 1; i >= 0; i -= 1) {
        const clause = node.caseBlock.clauses[i];
        fallthrough = list(clause.statements, fallthrough, { ...context, break: next }); clauses.unshift({ clause, head: fallthrough });
      }
      let test = clauses.find(row => ts.isDefaultClause(row.clause))?.head || next;
      for (let i = clauses.length - 1; i >= 0; i -= 1) if (ts.isCaseClause(clauses[i].clause)) {
        const { clause, head } = clauses[i], branch = add(clause, { kind: 'condition', predicate: { operation: 'strictEqual', inputs: [node.expression, clause.expression] } });
        link(branch, head, 'controlTrue', anchor(clause.expression)); link(branch, test, 'controlFalse', anchor(clause.expression));
        test = expression(clause.expression, branch, context);
      }
      return expression(node.expression, test, context);
    }
    if (ts.isTryStatement(node)) {
      if (node.finallyBlock) reasons.add('finally_completion_alternatives_conservative');
      // Separate finally routes retain abrupt destinations without merging them into normal flow.
      const wrap = target => finalizer(node.finallyBlock, target, context);
      const abrupt = new Set([...abruptKinds(node.tryBlock), ...abruptKinds(node.catchClause?.block)]);
      const normal = wrap(next), returned = abrupt.has('return') ? wrap(context.return) : context.return, thrown = wrap(context.exception);
      const labels = new Map([...context.labels].map(([name, targets]) => [name, {
        break: targets.break ? abrupt.has('break') ? wrap(targets.break) : targets.break : null,
        continue: targets.continue ? abrupt.has('continue') ? wrap(targets.continue) : targets.continue : null
      }]));
      const inner = { ...context, return: returned, exception: thrown, labels,
        break: context.break ? abrupt.has('break') ? wrap(context.break) : context.break : null,
        continue: context.continue ? abrupt.has('continue') ? wrap(context.continue) : context.continue : null };
      if (node.catchClause) {
        // Catch-body and binding failures go through finally toward the outer
        // exception route; they must never re-enter the same catch handler.
        const catchContext = { ...inner }, variable = node.catchClause.variableDeclaration;
        let caught = statement(node.catchClause.block, normal, catchContext);
        if (variable) {
          caught = ts.isIdentifier(variable.name)
            ? eventBlock(variable.name, { kind: 'catch', target: variable.name, value: variable, origin: 'unknown' }, caught, catchContext)
            : write(variable.name, variable, caught, catchContext, 'unknown');
        }
        inner.exception = caught;
      }
      return statement(node.tryBlock, normal, inner);
    }
    if (ts.isClassDeclaration(node)) return classDefinition(node, next, context);
    if (ts.isFunctionDeclaration(node) || ts.isEmptyStatement(node)
      || ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return next;
    reasons.add('unsupported_statement:' + ts.SyntaxKind[node.kind]);
    return expression(node, next, context);
  };
  try {
  const context = { return: exit, exception, break: null, continue: null, labels: new Map(), iterationLabels: [] };
  let head = ts.isSourceFile(owner) ? statement(owner, exit, context)
    : ts.isBlock(owner.body) ? statement(owner.body, exit, context)
      : expression(owner.body, eventBlock(owner.body, { kind: 'return', value: owner.body }, exit, context), context);
  for (let i = (owner.parameters?.length || 0) - 1; i >= 0; i -= 1) {
    const parameter = owner.parameters[i];
    if (parameter.initializer || parameter.dotDotDotToken || !ts.isIdentifier(parameter.name)) reasons.add('parameter_pattern_default_or_rest_conservative');
    const present = write(parameter.name, parameter, head, context, 'parameter');
    if (parameter.initializer) {
      const branch = add(parameter, { kind: 'condition', predicate: { operation: 'isUndefined', inputs: [parameter] } });
      link(branch, expression(parameter.initializer, write(parameter.name, parameter.initializer, head, context), context), 'controlTrue');
      link(branch, present, 'controlFalse');
      head = branch;
    } else head = present;
  }
  const entry = add(owner, null, 'entry'); link(entry, head);
  return { blocks, entry, exit, exception, reasons, stats, truncated: false };
  } catch (error) {
    if (error !== constructionStop) throw error;
    reasons.add('cfg_construction_work_or_byte_budget');
    // Discard the incomplete route graph. Its source owner remains unknown;
    // admitting a partial clone graph would invent completion destinations.
    return { blocks: [], entry: null, exit: null, exception: null, reasons, stats, truncated: true };
  }
};
