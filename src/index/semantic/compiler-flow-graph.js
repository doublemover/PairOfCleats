import { throwIfAborted } from '../../shared/abort.js';
/** Structured intraprocedural CFG. Nodes are syntax anchors, not runtime executions. */
export const buildCompilerFlowGraph = ({ ts, owner, sourceFile, expressionFor, signal }) => {
  const blocks = [], reasons = new Set();
  let sequence = 0;
  const add = (node, event = null, kind = 'normal') => {
    const block = { key: String(sequence++).padStart(10, '0'), node, site: expressionFor(node) || expressionFor(owner), event, kind, successors: [] };
    blocks.push(block); return block;
  };
  const link = (from, to, kind = 'controlNext', condition = null) => { if (to) from.successors.push({ to, kind, condition }); };
  const exit = add(owner, null, 'exit'), exception = add(owner, null, 'exception');
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
  const write = (target, value, next, context, origin = 'definition') => {
    if (ts.isIdentifier(target)) return eventBlock(target, { kind: 'write', target, value, origin }, next, context);
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) return eventBlock(target, { kind: 'heapWrite', target, value, origin, mayThrow: true }, next, context);
    reasons.add('destructuring_write_requires_pattern_analysis');
    return expression(target, eventBlock(target, { kind: 'unknownWrite', target, value }, next, context), context);
  };
  const isChain = node => node && (ts.isCallChain(node) || ts.isPropertyAccessChain(node) || ts.isElementAccessChain(node));
  // A nullish hop skips the entire contiguous optional-chain region, including
  // later computed keys and call arguments. Parentheses end that region.
  const optionalChain = (node, next, context, shortCircuit) => {
    throwIfAborted(signal);
    const call = ts.isCallExpression(node);
    let active = eventBlock(node, { kind: call ? 'operation' : 'heapRead', target: node, mayThrow: true }, next, context);
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
  const expression = (node, next, context) => {
    if (!node) return next;
    throwIfAborted(signal);
    if (ts.isClassExpression(node)) return classDefinition(node, next, context);
    if (ts.isFunctionLike(node)) return eventBlock(node, { kind: 'creation' }, next, context);
    if (ts.isIdentifier(node)) return lexicalRead(node) ? eventBlock(node, { kind: 'read', target: node }, next, context) : next;
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
        if (operator === ts.SyntaxKind.EqualsToken) {
          if (ts.isIdentifier(node.left)) return rhs;
          if (ts.isPropertyAccessExpression(node.left)) return expression(node.left.expression, rhs, context);
          if (ts.isElementAccessExpression(node.left)) return expression(node.left.expression, expression(node.left.argumentExpression, rhs, context), context);
        }
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
      || ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node);
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
        // ToPropertyKey itself can throw, even when evaluating its input cannot.
        head = expression(name.expression, eventBlock(name, {
          kind: 'operation', target: name, mayThrow: true
        }, head, context), context);
      }
    }
    head = eventBlock(node, { kind: 'creation', mayThrow: true }, head, context);
    const heritage = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    return expression(heritage?.expression, head, context);
  };
  const statement = (node, next, context) => {
    throwIfAborted(signal);
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
      const labels = new Map(context.labels); labels.set(node.label.text, { break: next, continue: null });
      return statement(node.statement, next, { ...context, labels, label: node.label.text });
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
      if (context.label) labels.set(context.label, { break: next, continue: step });
      const bodyContext = { ...context, break: next, continue: step, labels, label: null };
      let body = statement(node.statement, step, bodyContext);
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        reasons.add('iterator_protocol_and_per_iteration_binding_conservative');
        const binding = ts.isVariableDeclarationList(node.initializer) ? node.initializer.declarations[0]?.name : node.initializer;
        // The iterable is not the yielded element/key. Keep that value unknown
        // until an iterator model supplies a source-qualified producer.
        if (binding) body = write(binding, node, body, bodyContext, 'unknown');
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
      const wrap = target => node.finallyBlock ? statement(node.finallyBlock, target, context) : target;
      const normal = wrap(next), returned = wrap(context.return), thrown = wrap(context.exception);
      const labels = new Map([...context.labels].map(([name, targets]) => [name, {
        break: targets.break ? wrap(targets.break) : null,
        continue: targets.continue ? wrap(targets.continue) : null
      }]));
      const inner = { ...context, return: returned, exception: thrown, labels,
        break: context.break ? wrap(context.break) : null, continue: context.continue ? wrap(context.continue) : null };
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
  const context = { return: exit, exception, break: null, continue: null, labels: new Map(), label: null };
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
  return { blocks, entry, exit, exception, reasons };
};
