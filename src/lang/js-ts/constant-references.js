import babelTraverse from '@babel/traverse';

const traverse = babelTraverse.default || babelTraverse;

/** Resolve only immutable lexical references; never evaluate source code. */
export const collectConstantReferences = (ast) => {
  const keys = new WeakMap();
  const aliases = new WeakMap();
  // ESTree parser fallbacks retain their existing conservative behavior.
  if (ast?.type !== 'File' && !(ast?.type === 'Program' && Array.isArray(ast.directives))) {
    return { keys, aliases };
  }
  const resolve = (path, kind, seen = new Set()) => {
    if (!path?.node || seen.size >= 16) return null;
    if (kind === 'key') {
      if (path.isStringLiteral()) return path.node.value;
      if (path.isTemplateLiteral() && !path.node.expressions.length) {
        return path.node.quasis[0]?.value.cooked ?? null;
      }
      if (path.isBinaryExpression({ operator: '+' })) {
        const left = resolve(path.get('left'), kind, new Set(seen));
        const right = resolve(path.get('right'), kind, new Set(seen));
        return left !== null && right !== null && left.length + right.length <= 1024
          ? left + right : null;
      }
    }
    if (!path.isIdentifier()) return null;
    const binding = path.scope.getBinding(path.node.name);
    if (!binding?.constant || seen.has(binding)) return null;
    seen.add(binding);
    if (kind === 'alias' && binding.path.isFunctionDeclaration()) return { name: binding.identifier.name, binding };
    if (binding.kind !== 'const' || !binding.path.isVariableDeclarator()) return null;
    const init = binding.path.get('init');
    if (!init.node || !(init.node.end < path.node.start)) return null;
    if (kind === 'alias' && (init.isArrowFunctionExpression() || init.isFunctionExpression())) {
      return { name: binding.identifier.name, binding };
    }
    return resolve(init, kind, seen);
  };
  try {
    traverse(ast.type === 'Program' ? { type: 'File', program: ast } : ast, {
      MemberExpression(path) {
        if (!path.node.computed) return;
        const key = resolve(path.get('property'), 'key');
        if (key !== null) keys.set(path.node.property, key);
      },
      OptionalMemberExpression(path) {
        if (!path.node.computed) return;
        const key = resolve(path.get('property'), 'key');
        if (key !== null) keys.set(path.node.property, key);
      },
      CallExpression(path) {
        const callee = path.get('callee');
        const alias = resolve(callee, 'alias');
        if (alias !== null && callee.scope.getBinding(alias.name) === alias.binding) {
          aliases.set(callee.node, alias.name);
        }
      },
      OptionalCallExpression(path) {
        const callee = path.get('callee');
        const alias = resolve(callee, 'alias');
        if (alias !== null && callee.scope.getBinding(alias.name) === alias.binding) {
          aliases.set(callee.node, alias.name);
        }
      }
    });
  } catch {
    // Error-recovery ASTs can contain duplicate bindings that Babel scope rejects.
    // Discard partial proofs and leave the ordinary syntactic walker in charge.
    return { keys: new WeakMap(), aliases: new WeakMap() };
  }
  return { keys, aliases };
};
