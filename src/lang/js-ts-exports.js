export const MODULE_EXPORTS_VERSION = '2';
const inventories = new WeakMap();
const startOf = node => node?.start ?? node?.range?.[0];
const endOf = node => node?.end ?? node?.range?.[1];
const nameOf = node => node?.name ?? node?.value;
const patternNames = (node, names = []) => {
  if (!node) return names;
  if (node.type === 'Identifier') names.push(node.name);
  else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties || []) patternNames(prop.value || prop.argument, names);
  } else if (node.type === 'ArrayPattern') {
    for (const item of node.elements || []) patternNames(item, names);
  } else if (node.type === 'AssignmentPattern') patternNames(node.left, names);
  else if (node.type === 'RestElement') patternNames(node.argument, names);
  return names;
};
const memberPath = node => {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type !== 'MemberExpression') return null;
  const owner = memberPath(node.object);
  const prop = node.computed ? node.property?.value : node.property?.name;
  return owner && typeof prop === 'string' ? `${owner}.${prop}` : null;
};

const buildInventory = ast => {
  const declarations = new Map(), exported = new Map();
  const addExport = (local, name) => {
    if (typeof local !== 'string' || typeof name !== 'string') return;
    if (!exported.has(local)) exported.set(local, new Set());
    exported.get(local).add(name);
  };
  const addDeclaration = (name, node, owner, latestStart = startOf(node)) => {
    if (typeof name !== 'string') return;
    if (!declarations.has(name)) declarations.set(name, []);
    declarations.get(name).push({ start: startOf(owner), latestStart, end: endOf(owner) });
  };
  for (const stmt of ast.body) {
    const node = stmt.declaration || stmt;
    const names = [];
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers || []) addDeclaration(spec.local?.name, spec, stmt);
    }
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations || []) {
        for (const name of patternNames(decl.id)) {
          names.push(name); addDeclaration(name, decl, stmt, startOf(decl.init || decl));
        }
      }
    } else if (node.id?.name) {
      names.push(node.id.name); addDeclaration(node.id.name, node, stmt);
    } else if (stmt.type === 'ExportDefaultDeclaration' && node.type !== 'Identifier') {
      names.push('default'); addDeclaration('default', node, stmt);
      addDeclaration('anonymous', node, stmt);
    }
    if (stmt.type === 'ExportDefaultDeclaration') {
      addExport(node.type === 'Identifier' ? node.name : names[0], 'default');
      if (names[0] === 'default') addExport('anonymous', 'default');
    }
    if (stmt.type === 'ExportNamedDeclaration' && !stmt.source) {
      for (const name of names) addExport(name, name);
      for (const spec of stmt.specifiers || []) addExport(nameOf(spec.local), nameOf(spec.exported));
    }
    if (stmt.type === 'TSExportAssignment' && node.expression?.type === 'Identifier') {
      addExport(node.expression.name, 'default');
    }
  }
  const moduleBindings = new Set(declarations.keys());
  const assignments = ast.body.filter(stmt => stmt.type === 'ExpressionStatement'
    && stmt.expression?.type === 'AssignmentExpression' && stmt.expression.operator === '=');
  if (assignments.some(stmt => /^(?:module\.exports|exports\.)/.test(memberPath(stmt.expression.left) || ''))) {
    // A var inside a module-level block/loop still shadows the wrapper binding.
    // Function/class/namespace bodies own their vars and cannot shadow this scope.
    const stack = [...ast.body], seen = new WeakSet();
    const nestedScopes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
      'ClassDeclaration', 'ClassExpression', 'TSModuleDeclaration']);
    while (stack.length) {
      const node = stack.pop();
      if (!node || seen.has(node) || nestedScopes.has(node.type)) continue;
      seen.add(node);
      if (node.type === 'VariableDeclaration' && node.kind === 'var') {
        for (const decl of node.declarations) for (const name of patternNames(decl.id)) moduleBindings.add(name);
      }
      for (const value of Object.values(node)) {
        for (const child of Array.isArray(value) ? value : [value]) {
          if (child && typeof child.type === 'string') stack.push(child);
        }
      }
    }
  }
  // Only module-level, unshadowed CommonJS names supply export evidence.
  for (const stmt of ast.body) {
    const expr = stmt.type === 'ExpressionStatement' ? stmt.expression : null;
    if (expr?.type !== 'AssignmentExpression' || expr.operator !== '=') continue;
    const left = memberPath(expr.left);
    let name;
    if (!moduleBindings.has('module') && left === 'module.exports') name = 'default';
    else if (!moduleBindings.has('module') && left?.startsWith('module.exports.')) name = left.slice(15);
    else if (!moduleBindings.has('exports') && left?.startsWith('exports.')) name = left.slice(8);
    if (!name || name.includes('.')) continue;
    if (expr.right.type === 'Identifier') addExport(expr.right.name, name);
    else if (['FunctionExpression', 'ArrowFunctionExpression'].includes(expr.right.type)) {
      addDeclaration(left, expr, stmt, startOf(expr.right)); addExport(left, name);
    }
  }
  return { declarations, exported };
};

/** Module syntax supplies binding identity; declaration kind and signature text do not. */
export const resolveJsTsExports = (ast, chunk) => {
  if (!ast || !Array.isArray(ast.body) || ast.errors?.length) return { exported: null, exportNames: [] };
  let inventory = inventories.get(ast);
  if (!inventory) { inventory = buildInventory(ast); inventories.set(ast, inventory); }
  const start = chunk?.start, end = chunk?.end;
  const declarations = inventory.declarations.get(chunk?.name) || [];
  const declaration = declarations.find(entry => Number.isSafeInteger(start) && Number.isSafeInteger(end)
    && start >= entry.start && start <= entry.latestStart && end <= entry.end);
  if (!declaration && declarations.length) return { exported: null, exportNames: [] };
  const names = declaration ? inventory.exported.get(chunk.name) : null;
  const exportNames = names ? [...names].sort() : [];
  return { exported: exportNames.length > 0, exportNames };
};
