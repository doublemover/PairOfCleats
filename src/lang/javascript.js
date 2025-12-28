import * as acorn from 'acorn';
import * as esprima from 'esprima';

/**
 * JavaScript/TypeScript-like chunking and relations.
 * Uses Acorn/Esprima for lightweight AST extraction.
 */

function locMeta(node) {
  return node && node.loc ? {
    startLine: node.loc.start.line,
    endLine: node.loc.end.line
  } : {};
}

function keyName(key) {
  if (!key) return 'anonymous';
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  if (key.type === 'PrivateIdentifier') return `#${key.name}`;
  return 'computed';
}

function visibilityFor(name) {
  if (!name) return 'public';
  if (name.startsWith('#')) return 'private';
  if (name.startsWith('__') && !name.endsWith('__')) return 'private';
  if (name.startsWith('_') && !name.startsWith('__')) return 'protected';
  return 'public';
}

function collectPatternNames(node, out) {
  if (!node) return;
  if (node.type === 'Identifier') {
    out.push(node.name);
    return;
  }
  if (node.type === 'RestElement') {
    collectPatternNames(node.argument, out);
    return;
  }
  if (node.type === 'AssignmentPattern') {
    collectPatternNames(node.left, out);
    return;
  }
  if (node.type === 'ArrayPattern') {
    node.elements?.forEach((el) => collectPatternNames(el, out));
    return;
  }
  if (node.type === 'ObjectPattern') {
    node.properties?.forEach((prop) => {
      if (prop.type === 'Property') collectPatternNames(prop.value, out);
      if (prop.type === 'RestElement') collectPatternNames(prop.argument, out);
    });
  }
}

function formatDefault(node) {
  if (!node) return '...';
  if (node.type === 'Literal') return JSON.stringify(node.value);
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'TemplateLiteral') return '`...`';
  if (node.type === 'ArrayExpression') return '[...]';
  if (node.type === 'ObjectExpression') return '{...}';
  if (node.type === 'CallExpression') return 'call(...)';
  return '...';
}

function formatParam(node) {
  if (!node) return 'param';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'RestElement') return `...${formatParam(node.argument)}`;
  if (node.type === 'AssignmentPattern') {
    return `${formatParam(node.left)}=${formatDefault(node.right)}`;
  }
  if (node.type === 'ObjectPattern') return '{...}';
  if (node.type === 'ArrayPattern') return '[...]';
  return 'param';
}

/**
 * Build chunk metadata for JS declarations.
 * Returns null when parsing fails.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildJsChunks(text) {
  const chunks = [];
  const addChunk = (node, name, kind) => {
    if (!node) return;
    chunks.push({
      start: node.start,
      end: node.end,
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
      if (method.type === 'MethodDefinition' && method.key && method.value) {
        addChunk(method, `${className}.${keyName(method.key)}`, 'MethodDefinition');
      }
      if (method.type === 'PropertyDefinition' && method.key && method.value &&
        (method.value.type === 'FunctionExpression' || method.value.type === 'ArrowFunctionExpression')) {
        addChunk(method, `${className}.${keyName(method.key)}`, 'ClassPropertyFunction');
      }
    }
  };

  try {
    const ast = acorn.parse(text, { ecmaVersion: 'latest', locations: true, sourceType: 'module' });
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
          addChunk(node.declaration, node.declaration.id ? node.declaration.id.name : 'anonymous', 'ExportedFunction');
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
  } catch {
    return null;
  }

  if (!chunks.length) return [{ start: 0, end: text.length, name: 'root', kind: 'Module', meta: {} }];
  return chunks;
}

/**
 * Collect import/require dependencies from JS source.
 * @param {string} text
 * @returns {string[]}
 */
export function collectImports(text) {
  const imports = new Set();
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;

    if (node.type === 'ImportDeclaration') {
      if (node.source && node.source.value) imports.add(node.source.value);
    }
    if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal') {
      if (typeof node.source.value === 'string') imports.add(node.source.value);
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' &&
      node.callee.name === 'require') {
      const arg = node.arguments?.[0];
      if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
        imports.add(arg.value);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (child && typeof child === 'object') walk(child);
    }
  };

  try {
    const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
    walk(ast);
  } catch {}
  return Array.from(imports);
}

/**
 * Build import/export/call/usage relations for JS chunks.
 * @param {string} text
 * @param {string} relPath
 * @param {Record<string,string[]>} allImports
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildCodeRelations(text, relPath, allImports, options = {}) {
  const dataflowEnabled = options.dataflow !== false;
  const imports = new Set();
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  const functionMeta = {};
  const classMeta = {};
  const flowByName = new Map();
  const functionStack = [];
  const classStack = [];

  const getMemberName = (node) => {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'ThisExpression') return 'this';
    if (node.type === 'Super') return 'super';
    if (node.type === 'MemberExpression') {
      const obj = getMemberName(node.object);
      const prop = node.computed
        ? (node.property?.type === 'Literal' ? String(node.property.value) : null)
        : (node.property?.name || null);
      if (obj && prop) return `${obj}.${prop}`;
      return obj || prop;
    }
    return null;
  };

  const getCalleeName = (callee) => {
    if (!callee) return null;
    if (callee.type === 'ChainExpression') return getCalleeName(callee.expression);
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression') return getMemberName(callee);
    if (callee.type === 'Super') return 'super';
    return null;
  };

  const currentFunction = () => (functionStack.length ? functionStack[functionStack.length - 1] : null);

  const ensureFlow = (name) => {
    if (!flowByName.has(name)) {
      flowByName.set(name, {
        reads: new Set(),
        writes: new Set(),
        mutations: new Set(),
        throws: new Set(),
        awaits: new Set(),
        returns: false,
        yields: false
      });
    }
    return flowByName.get(name);
  };

  const recordRead = (name) => {
    if (!dataflowEnabled || !name) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).reads.add(name);
  };

  const recordWrite = (name) => {
    if (!dataflowEnabled || !name) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).writes.add(name);
  };

  const recordMutation = (name) => {
    if (!dataflowEnabled || !name) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).mutations.add(name);
  };

  const recordThrow = (name) => {
    if (!dataflowEnabled || !name) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).throws.add(name);
  };

  const recordAwait = (name) => {
    if (!dataflowEnabled || !name) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).awaits.add(name);
  };

  const recordReturn = () => {
    if (!dataflowEnabled) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).returns = true;
  };

  const recordYield = () => {
    if (!dataflowEnabled) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).yields = true;
  };

  const inferFunctionName = (node, parent) => {
    if (node.id && node.id.name) return node.id.name;
    if (parent && parent.type === 'VariableDeclarator' && parent.id?.name) return parent.id.name;
    if (parent && parent.type === 'AssignmentExpression') {
      const left = getMemberName(parent.left);
      if (left) return left;
    }
    if (parent && (parent.type === 'Property' || parent.type === 'PropertyDefinition') && parent.key) {
      const propName = keyName(parent.key);
      const className = classStack[classStack.length - 1];
      return className ? `${className}.${propName}` : propName;
    }
    if (parent && parent.type === 'MethodDefinition' && parent.key) {
      const propName = keyName(parent.key);
      const className = classStack[classStack.length - 1];
      return className ? `${className}.${propName}` : propName;
    }
    return '(anonymous)';
  };

  const collectParamMeta = (node) => {
    const params = [];
    const paramNames = [];
    const paramDefaults = {};
    if (!node?.params) return { params, paramNames, paramDefaults };
    node.params.forEach((param) => {
      params.push(formatParam(param));
      const names = [];
      collectPatternNames(param, names);
      names.forEach((name) => {
        paramNames.push(name);
        if (param.type === 'AssignmentPattern' && param.left?.type === 'Identifier') {
          paramDefaults[name] = formatDefault(param.right);
        }
      });
    });
    return { params, paramNames, paramDefaults };
  };

  const buildSignature = (node, name) => {
    const { params } = collectParamMeta(node);
    const paramsStr = params.join(', ');
    if (node.type === 'ArrowFunctionExpression') {
      return `(${paramsStr}) =>`;
    }
    const fnName = name && name !== '(anonymous)' ? ` ${name}` : '';
    return `function${fnName}(${paramsStr})`;
  };

  const registerFunctionMeta = (node, parent) => {
    const name = inferFunctionName(node, parent);
    const existing = functionMeta[name];
    const { paramNames, paramDefaults } = collectParamMeta(node);
    const signature = buildSignature(node, name);
    const modifiers = {
      async: !!node.async,
      generator: !!node.generator,
      static: false,
      visibility: visibilityFor(name.split('.').pop() || name)
    };
    let methodKind = null;
    if (parent && parent.type === 'MethodDefinition') {
      modifiers.static = !!parent.static;
      methodKind = parent.kind || null;
      const key = keyName(parent.key);
      modifiers.visibility = visibilityFor(key);
    }
    if (!existing) {
      functionMeta[name] = {
        params: paramNames,
        paramDefaults,
        signature,
        modifiers,
        methodKind,
        returnType: null,
        returnsValue: false,
        throws: [],
        awaits: [],
        yields: false,
        dataflow: null
      };
    } else {
      existing.params = existing.params?.length ? existing.params : paramNames;
      existing.paramDefaults = Object.keys(existing.paramDefaults || {}).length ? existing.paramDefaults : paramDefaults;
      existing.signature = existing.signature || signature;
      existing.modifiers = existing.modifiers || modifiers;
      existing.methodKind = existing.methodKind || methodKind;
    }
    return name;
  };

  const getThrownName = (node) => {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression') return getMemberName(node);
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      return getCalleeName(node.callee);
    }
    return null;
  };

  const getAwaitName = (node) => {
    if (!node) return null;
    if (node.type === 'CallExpression') return getCalleeName(node.callee);
    return getCalleeName(node) || getMemberName(node);
  };

  const isFunctionNode = (node) =>
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression';

  const isIdentifierBinding = (node, parent) => {
    if (!parent || node.type !== 'Identifier') return false;
    if ((parent.type === 'VariableDeclarator' || parent.type === 'AssignmentPattern') && parent.id === node) return true;
    if ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression') && parent.id === node) return true;
    if ((parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') && parent.id === node) return true;
    if (parent.type === 'CatchClause' && parent.param === node) return true;
    if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier') {
      return parent.local === node;
    }
    if (parent.type === 'Property' && parent.key === node && !parent.computed) return true;
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return true;
    if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return true;
    if (parent.type === 'PropertyDefinition' && parent.key === node && !parent.computed) return true;
    if (parent.type === 'LabeledStatement' && parent.label === node) return true;
    return false;
  };

  const shouldCountRead = (node, parent) => !isIdentifierBinding(node, parent);

  const recordPatternWrite = (pattern) => {
    const names = [];
    collectPatternNames(pattern, names);
    names.forEach((name) => recordWrite(name));
  };

  const walk = (node, parent) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, parent));
      return;
    }
    if (typeof node !== 'object') return;

    if (node.type === 'ImportDeclaration') {
      if (node.source?.value) imports.add(node.source.value);
      node.specifiers?.forEach((s) => {
        if (s.local?.name) usages.add(s.local.name);
      });
    }

    if (node.type === 'ImportExpression' && node.source?.type === 'Literal') {
      if (typeof node.source.value === 'string') imports.add(node.source.value);
    }

    if (node.type === 'ExportAllDeclaration') {
      exports.add('*');
    }

    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        if (node.declaration.id?.name) exports.add(node.declaration.id.name);
        if (node.declaration.declarations) {
          node.declaration.declarations.forEach((d) => d.id?.name && exports.add(d.id.name));
        }
      }
      node.specifiers?.forEach((s) => {
        if (s.exported?.name) exports.add(s.exported.name);
      });
    }

    if (node.type === 'ExportDefaultDeclaration') {
      if (node.declaration?.id?.name) exports.add(node.declaration.id.name);
      else exports.add('default');
    }

    if (node.type === 'AssignmentExpression') {
      const left = getMemberName(node.left);
      if (left === 'module.exports') exports.add('default');
      if (left && left.startsWith('exports.')) exports.add(left.slice('exports.'.length));
    }

    if (node.type === 'CallExpression') {
      const calleeName = getCalleeName(node.callee);
      const callerName = functionStack.length ? functionStack[functionStack.length - 1] : '(module)';
      if (calleeName) calls.push([callerName, calleeName]);
    }

    if (node.type === 'Identifier') {
      usages.add(node.name);
      if (shouldCountRead(node, parent)) {
        recordRead(node.name);
      }
    }

    if (node.type === 'VariableDeclarator' && node.id) {
      recordPatternWrite(node.id);
    }

    if (node.type === 'AssignmentExpression' && node.left) {
      if (node.left.type === 'Identifier') {
        recordWrite(node.left.name);
      } else if (node.left.type === 'MemberExpression') {
        recordMutation(getMemberName(node.left));
      } else {
        recordPatternWrite(node.left);
      }
    }

    if (node.type === 'UpdateExpression' && node.argument) {
      if (node.argument.type === 'Identifier') {
        recordWrite(node.argument.name);
      } else if (node.argument.type === 'MemberExpression') {
        recordMutation(getMemberName(node.argument));
      }
    }

    if (node.type === 'ReturnStatement') {
      recordReturn();
    }

    if (node.type === 'ThrowStatement') {
      const thrown = getThrownName(node.argument);
      if (thrown) recordThrow(thrown);
    }

    if (node.type === 'AwaitExpression') {
      const awaited = getAwaitName(node.argument);
      if (awaited) recordAwait(awaited);
    }

    if (node.type === 'YieldExpression') {
      recordYield();
    }

    if (node.type === 'CatchClause' && node.param) {
      recordPatternWrite(node.param);
    }

    if ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') && node.left && node.left.type !== 'VariableDeclaration') {
      if (node.left.type === 'Identifier') {
        recordWrite(node.left.name);
      } else if (node.left.type === 'MemberExpression') {
        recordMutation(getMemberName(node.left));
      } else {
        recordPatternWrite(node.left);
      }
    }

    if (node.type === 'ClassDeclaration' && node.id?.name) {
      const className = node.id.name;
      const extendsName = getMemberName(node.superClass);
      classMeta[className] = {
        extends: extendsName ? [extendsName] : [],
        modifiers: { visibility: visibilityFor(className) }
      };
      classStack.push(node.id.name);
      if (node.body?.body) {
        walk(node.body.body, node);
      }
      classStack.pop();
      return;
    }

    if (isFunctionNode(node)) {
      const fnName = registerFunctionMeta(node, parent);
      functionStack.push(fnName);
      walk(node.body, node);
      functionStack.pop();
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (child && typeof child === 'object') {
        walk(child, node);
      }
    }
  };

  try {
    const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
    walk(ast, null);
    const tokens = esprima.tokenize(text, { tolerant: true });
    tokens.forEach((t) => {
      if (t.type === 'Identifier') usages.add(t.value);
    });
  } catch {}

  if (dataflowEnabled) {
    for (const [name, flow] of flowByName.entries()) {
      const meta = functionMeta[name] || {};
      meta.dataflow = {
        reads: Array.from(flow.reads),
        writes: Array.from(flow.writes),
        mutations: Array.from(flow.mutations)
      };
      meta.throws = Array.from(flow.throws);
      meta.awaits = Array.from(flow.awaits);
      meta.returnsValue = !!flow.returns;
      meta.yields = !!flow.yields;
      meta.modifiers = meta.modifiers || {};
      meta.modifiers.generator = !!flow.yields;
      functionMeta[name] = meta;
    }
  }

  const importLinks = Array.from(imports)
    .map((i) => allImports[i])
    .filter((x) => !!x)
    .flat();
  return {
    imports: Array.from(imports),
    exports: Array.from(exports),
    calls,
    usages: Array.from(usages),
    importLinks,
    functionMeta,
    classMeta
  };
}

/**
 * Extract lightweight doc metadata for JS chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @returns {{doc:string,params:string[],returns:boolean,signature:(string|null)}}
 */
export function extractDocMeta(text, chunk, astMeta = null) {
  const chunkText = text.slice(chunk.start, chunk.end);
  const lines = chunkText.split('\n');
  const docLines = lines.filter((l) => l.trim().startsWith('*') || l.trim().startsWith('//') || l.trim().startsWith('#'));
  const params = [...chunkText.matchAll(/@param +(\w+)/g)].map((m) => m[1]);
  const returnsDoc = !!chunkText.match(/@returns? /);
  const returnTypeMatch = chunkText.match(/@returns?\s+{([^}]+)}/);
  const returnType = returnTypeMatch ? returnTypeMatch[1].trim() : null;
  const paramTypes = {};
  for (const match of chunkText.matchAll(/@param\s+{([^}]+)}\s+(\w+)/g)) {
    paramTypes[match[2]] = match[1].trim();
  }
  let signature = null;
  const matchFn = chunkText.match(/function\s+([A-Za-z0-9_$]+)?\s*\(([^\)]*)\)/);
  if (matchFn) {
    signature = `function ${matchFn[1] || ''}(${matchFn[2]})`;
  }

  const nameMeta = astMeta?.functionMeta?.[chunk.name] || astMeta?.classMeta?.[chunk.name] || null;
  const metaParams = Array.isArray(nameMeta?.params) && nameMeta.params.length ? nameMeta.params : params;
  const mergedSignature = nameMeta?.signature || signature;
  const mergedReturnType = nameMeta?.returnType || returnType || null;

  return {
    doc: docLines.join('\n').slice(0, 300),
    params: metaParams,
    paramTypes,
    paramDefaults: nameMeta?.paramDefaults || {},
    returnType: mergedReturnType,
    returnsValue: nameMeta?.returnsValue || false,
    returns: returnsDoc,
    signature: mergedSignature,
    modifiers: nameMeta?.modifiers || null,
    methodKind: nameMeta?.methodKind || null,
    dataflow: nameMeta?.dataflow || null,
    throws: nameMeta?.throws || [],
    awaits: nameMeta?.awaits || [],
    yields: nameMeta?.yields || false,
    extends: nameMeta?.extends || astMeta?.classMeta?.[chunk.name]?.extends || []
  };
}
