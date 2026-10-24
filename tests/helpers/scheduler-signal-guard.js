import { parse } from '@babel/parser';

const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod']);
const bindingNames = pattern => {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'RestElement') return bindingNames(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindingNames(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindingNames);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(property => bindingNames(property.value || property.argument));
  return [];
};

/** Inspect the actual scheduler token argument, including const aliases and
 * lexical shadowing. Nearby properties/comments cannot qualify a call. */
export const findSchedulerSignalViolations = source => {
  if (!/\bscheduler\s*(?:\?\.|\.)\s*schedule\b/u.test(source)) return [];
  const scopes = new WeakMap(), calls = [];
  const visit = (node, scope, parent = null) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Program' || node.type === 'BlockStatement' || functionTypes.has(node.type) || node.type === 'CatchClause') {
      scope = { parent: scope, bindings: new Map(), assignments: new Map() };
      for (const parameter of node.params || [node.param]) {
        for (const name of bindingNames(parameter)) scope.bindings.set(name, null);
      }
    }
    scopes.set(node, scope);
    if (node.type === 'VariableDeclarator') {
      for (const name of bindingNames(node.id)) scope.bindings.set(name,
        parent.kind === 'const' && node.id.type === 'Identifier' ? node.init : null);
      if (node.id.type === 'Identifier' && node.init) scope.assignments.set(node.id.name, [node.init]);
    }
    if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'Identifier') {
      for (let current = scope; current; current = current.parent) {
        if (!current.bindings.has(node.left.name)) continue;
        const assignments = current.assignments.get(node.left.name) || [];
        assignments.push(node.right);
        current.assignments.set(node.left.name, assignments);
        break;
      }
    }
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const callee = node.callee, owner = callee?.object;
      if (callee?.property?.name === 'schedule' && !callee.computed
        && (owner?.type === 'Identifier' && owner.name === 'scheduler' || owner?.property?.name === 'scheduler' && !owner.computed)) {
        calls.push(node);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) visit(child, scope, node); }
      else if (value && typeof value === 'object') visit(value, scope, node);
    }
  };
  visit(parse(source, { sourceType: 'module' }), null);
  const resolve = (node, scope, before, seen = new Set()) => {
    if (node?.type !== 'Identifier') return node;
    for (let current = scope; current; current = current.parent) {
      if (!current.bindings.has(node.name)) continue;
      const value = current.bindings.get(node.name);
      if (!value || value.start >= before || seen.has(value)) return null;
      seen.add(value);
      return resolve(value, scopes.get(value), value.start, seen);
    }
    return null;
  };
  const isDebouncedSchedule = call => {
    if (call.arguments.length || call.callee?.object?.type !== 'Identifier') return false;
    const name = call.callee.object.name;
    for (let current = scopes.get(call); current; current = current.parent) {
      if (!current.bindings.has(name)) continue;
      const assignments = current.assignments.get(name) || [];
      return assignments.length === 1 && assignments[0]?.type === 'CallExpression'
        && assignments[0].callee?.type === 'Identifier'
        && assignments[0].callee.name === 'createDebouncedScheduler';
    }
    return false;
  };
  return calls.filter(call => {
    if (isDebouncedSchedule(call)) return false;
    const tokens = resolve(call.arguments[1], scopes.get(call), call.start);
    return tokens?.type !== 'ObjectExpression' || !tokens.properties.some(property =>
      property.type === 'ObjectProperty' && !property.computed
      && (property.key.name === 'signal' || property.key.value === 'signal'));
  }).map(call => call.loc.start.line);
};
