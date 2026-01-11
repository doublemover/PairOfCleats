import { buildTreeSitterChunks } from '../tree-sitter.js';
import { keyName, locMeta, nodeEnd, nodeStart } from './ast-utils.js';
import { parseJavaScriptAst } from './parse.js';

/**
 * Build chunk metadata for JS declarations.
 * Returns null when parsing fails.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildJsChunks(text, options = {}) {
  if (options.treeSitter) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: null,
      ext: options.ext,
      options: { treeSitter: options.treeSitter, log: options.log }
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
  const chunks = [];
  const addChunk = (node, name, kind) => {
    if (!node) return;
    chunks.push({
      start: nodeStart(node),
      end: nodeEnd(node),
      name: name || 'anonymous',
      kind,
      meta: { ...locMeta(node) }
    });
  };

  const addFunctionFromDeclarator = (decl, kind) => {
    if (!decl || !decl.init) return;
    const init = decl.init;
    if (init.type !== 'FunctionExpression' && init.type !== 'ArrowFunctionExpression') return;
    const name = decl.id && decl.id.name ? decl.id.name : 'anonymous';
    const derivedKind = init.type === 'FunctionExpression' ? 'FunctionExpression' : 'ArrowFunction';
    addChunk(decl, name, kind || derivedKind);
  };

  const addFunctionFromAssignment = (expr, kind) => {
    if (!expr || expr.type !== 'AssignmentExpression') return;
    const right = expr.right;
    if (!right || (right.type !== 'FunctionExpression' && right.type !== 'ArrowFunctionExpression')) return;
    let name = 'anonymous';
    if (expr.left && expr.left.type === 'MemberExpression') {
      const obj = expr.left.object?.name || '';
      const prop = keyName(expr.left.property);
      name = obj ? `${obj}.${prop}` : prop;
    }
    addChunk(expr, name, kind);
  };
  const addClassChunks = (node, name, kind) => {
    if (!node) return;
    const className = name || 'anonymous';
    addChunk(node, className, kind || 'ClassDeclaration');
    if (!node.body?.body) return;
    for (const method of node.body.body) {
      if ((method.type === 'MethodDefinition' && method.key && method.value)
        || method.type === 'ClassMethod'
        || method.type === 'ClassPrivateMethod') {
        const key = method.key || method.id;
        addChunk(method, `${className}.${keyName(key)}`, 'MethodDefinition');
      }
      if ((method.type === 'PropertyDefinition'
        || method.type === 'ClassProperty'
        || method.type === 'ClassPrivateProperty')
        && method.key && method.value
        && (method.value.type === 'FunctionExpression' || method.value.type === 'ArrowFunctionExpression')) {
        addChunk(method, `${className}.${keyName(method.key)}`, 'ClassPropertyFunction');
      }
    }
  };

  const ast = options.ast || parseJavaScriptAst(text, options);
  if (!ast || !Array.isArray(ast.body)) return null;
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') {
      addChunk(node, node.id ? node.id.name : 'anonymous', 'FunctionDeclaration');
    }

    if (node.type === 'ClassDeclaration') {
      const className = node.id ? node.id.name : 'anonymous';
      addClassChunks(node, className, 'ClassDeclaration');
    }

    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      if (node.declaration.type === 'FunctionDeclaration') {
        addChunk(
          node.declaration,
          node.declaration.id ? node.declaration.id.name : 'anonymous',
          'ExportedFunction'
        );
      }
      if (node.declaration.type === 'VariableDeclaration') {
        for (const decl of node.declaration.declarations) {
          const init = decl.init;
          if (!init) continue;
          const exportKind = init.type === 'FunctionExpression'
            ? 'ExportedFunctionExpression'
            : 'ExportedArrowFunction';
          addFunctionFromDeclarator(decl, exportKind);
        }
      }
      if (node.declaration.type === 'ClassDeclaration') {
        const className = node.declaration.id ? node.declaration.id.name : 'anonymous';
        addClassChunks(node.declaration, className, 'ExportedClass');
      }
    }

    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        addFunctionFromDeclarator(decl);
      }
    }

    if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
      const decl = node.declaration;
      if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
        const name = decl.id ? decl.id.name : 'default';
        if (decl.type === 'ClassDeclaration') {
          addClassChunks(decl, name, `ExportDefault${decl.type}`);
        } else {
          addChunk(decl, name, `ExportDefault${decl.type}`);
        }
      } else if (decl.type === 'FunctionExpression' || decl.type === 'ArrowFunctionExpression') {
        addChunk(decl, 'default', 'ExportDefaultFunction');
      }
    }

    if (node.type === 'ExpressionStatement' && node.expression) {
      addFunctionFromAssignment(node.expression, 'ExportedAssignmentFunction');
    }
  }

  if (!chunks.length) return [{ start: 0, end: text.length, name: 'root', kind: 'Module', meta: {} }];
  return chunks;
}
