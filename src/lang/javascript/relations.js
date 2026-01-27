import * as esprima from 'esprima';
import {
  collectPatternNames,
  formatDefault,
  formatParam,
  keyName,
  visibilityFor
} from './ast-utils.js';
import { parseJavaScriptAst } from './parse.js';

/**
 * Build import/export/call/usage relations for JS chunks.
 * @param {string} text
 * @param {string} relPath
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildCodeRelations(text, relPath, options = {}) {
  const dataflowEnabled = options.dataflow !== false;
  const controlFlowEnabled = options.controlFlow !== false;
  const imports = new Set();
  const exports = new Set();
  const calls = [];
  const callDetails = [];
  const usages = new Set();
  const functionMeta = {};
  const classMeta = {};
  const flowByName = new Map();
  const functionStack = [];
  const classStack = [];

  const getMemberName = (node) => {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'PrivateName' && node.id?.name) return `#${node.id.name}`;
    if (node.type === 'ThisExpression') return 'this';
    if (node.type === 'Super') return 'super';
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      const obj = getMemberName(node.object);
      const prop = node.computed
        ? (node.property?.type === 'Literal' || node.property?.type === 'StringLiteral'
          ? String(node.property.value)
          : null)
        : (node.property?.name || node.property?.id?.name || null);
      if (obj && prop) return `${obj}.${prop}`;
      return obj || prop;
    }
    return null;
  };

  const getCalleeName = (callee) => {
    if (!callee) return null;
    if (callee.type === 'ChainExpression') return getCalleeName(callee.expression);
    if (callee.type === 'OptionalCallExpression') return getCalleeName(callee.callee);
    if (callee.type === 'Import') return null;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
      return getMemberName(callee);
    }
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
        aliases: new Set(),
        throws: new Set(),
        awaits: new Set(),
        returns: false,
        yields: false,
        controlFlow: null
      });
    }
    return flowByName.get(name);
  };

  const recordControl = (key, delta = 1) => {
    if (!controlFlowEnabled) return;
    const scope = currentFunction();
    if (!scope) return;
    const flow = ensureFlow(scope);
    if (!flow.controlFlow) {
      flow.controlFlow = {
        branches: 0,
        loops: 0,
        returns: 0,
        throws: 0,
        awaits: 0,
        yields: 0,
        breaks: 0,
        continues: 0
      };
    }
    flow.controlFlow[key] = (flow.controlFlow[key] || 0) + delta;
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

  const recordAlias = (name, target) => {
    if (!dataflowEnabled || !name || !target) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).aliases.add(`${name}=${target}`);
  };

  const recordThrow = (name) => {
    recordControl('throws');
    if (!dataflowEnabled || !name) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).throws.add(name);
  };

  const recordAwait = (name) => {
    recordControl('awaits');
    if (!dataflowEnabled || !name) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).awaits.add(name);
  };

  const recordReturn = () => {
    recordControl('returns');
    if (!dataflowEnabled) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).returns = true;
  };

  const recordYield = () => {
    recordControl('yields');
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
    if ((node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') && node.key) {
      const propName = keyName(node.key);
      const className = classStack[classStack.length - 1];
      return className ? `${className}.${propName}` : propName;
    }
    if (parent && (parent.type === 'Property' || parent.type === 'PropertyDefinition') && parent.key) {
      const propName = keyName(parent.key);
      const className = classStack[classStack.length - 1];
      return className ? `${className}.${propName}` : propName;
    }
    if (parent && (parent.type === 'ObjectProperty' || parent.type === 'ClassProperty'
      || parent.type === 'ClassPrivateProperty') && parent.key) {
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
    if (node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') {
      modifiers.static = !!node.static;
      methodKind = node.kind || null;
      const key = keyName(node.key);
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
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod' ||
    node.type === 'ObjectMethod';

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
    if (parent.type === 'ObjectProperty' && parent.key === node && !parent.computed) return true;
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return true;
    if (parent.type === 'OptionalMemberExpression' && parent.property === node && !parent.computed) return true;
    if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return true;
    if (parent.type === 'PropertyDefinition' && parent.key === node && !parent.computed) return true;
    if ((parent.type === 'ClassProperty' || parent.type === 'ClassPrivateProperty')
      && parent.key === node && !parent.computed) {
      return true;
    }
    if ((parent.type === 'ClassMethod' || parent.type === 'ClassPrivateMethod')
      && parent.key === node && !parent.computed) {
      return true;
    }
    if (parent.type === 'LabeledStatement' && parent.label === node) return true;
    return false;
  };

  const shouldCountRead = (node, parent) => !isIdentifierBinding(node, parent);

  const recordPatternWrite = (pattern) => {
    const names = [];
    collectPatternNames(pattern, names);
    names.forEach((name) => recordWrite(name));
  };

  const MAX_CALL_ARGS = 5;
  const MAX_CALL_ARG_LEN = 80;
  const MAX_CALL_ARG_DEPTH = 2;

  const normalizeCallText = (value) => {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  };

  const truncateCallText = (value, maxLen = MAX_CALL_ARG_LEN) => {
    const normalized = normalizeCallText(value);
    if (!normalized) return '';
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLen - 3))}...`;
  };

  const resolveCalleeParts = (calleeName) => {
    if (!calleeName) return { calleeRaw: null, calleeNormalized: null, receiver: null };
    const raw = String(calleeName);
    const parts = raw.split('.').filter(Boolean);
    if (!parts.length) return { calleeRaw: raw, calleeNormalized: raw, receiver: null };
    if (parts.length === 1) {
      return { calleeRaw: raw, calleeNormalized: parts[0], receiver: null };
    }
    return {
      calleeRaw: raw,
      calleeNormalized: parts[parts.length - 1],
      receiver: parts.slice(0, -1).join('.')
    };
  };

  const resolveCallLocation = (node) => {
    if (!node || typeof node !== 'object') return null;
    const start = Number.isFinite(node.start)
      ? node.start
      : (Array.isArray(node.range) ? node.range[0] : null);
    const end = Number.isFinite(node.end)
      ? node.end
      : (Array.isArray(node.range) ? node.range[1] : null);
    const loc = node.loc || null;
    const startLine = Number.isFinite(loc?.start?.line) ? loc.start.line : null;
    const startCol = Number.isFinite(loc?.start?.column) ? loc.start.column + 1 : null;
    const endLine = Number.isFinite(loc?.end?.line) ? loc.end.line : null;
    const endCol = Number.isFinite(loc?.end?.column) ? loc.end.column + 1 : null;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return {
      start,
      end,
      startLine,
      startCol,
      endLine,
      endCol
    };
  };

  const formatCallArg = (arg, depth = 0) => {
    if (!arg || depth > MAX_CALL_ARG_DEPTH) return '...';
    if (arg.type === 'Identifier') return arg.name;
    if (arg.type === 'Literal') return JSON.stringify(arg.value);
    if (arg.type === 'StringLiteral' || arg.type === 'NumericLiteral' || arg.type === 'BooleanLiteral') {
      return JSON.stringify(arg.value);
    }
    if (arg.type === 'MemberExpression' || arg.type === 'OptionalMemberExpression') {
      return getMemberName(arg) || 'member';
    }
    if (arg.type === 'CallExpression' || arg.type === 'OptionalCallExpression') {
      const callee = getCalleeName(arg.callee);
      return callee ? `${callee}(...)` : 'call(...)';
    }
    if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') return 'fn(...)';
    if (arg.type === 'ObjectExpression') return '{...}';
    if (arg.type === 'ArrayExpression') return '[...]';
    if (arg.type === 'TemplateLiteral') return '`...`';
    if (arg.type === 'SpreadElement') {
      const inner = formatCallArg(arg.argument, depth + 1);
      return inner ? `...${inner}` : '...';
    }
    return '...';
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

    if (node.type === 'ImportExpression' && node.source) {
      const sourceValue = node.source.value;
      if (typeof sourceValue === 'string') imports.add(sourceValue);
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Import') {
      const arg = node.arguments?.[0];
      const value = arg && (arg.value ?? null);
      if (typeof value === 'string') imports.add(value);
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier'
      && node.callee.name === 'require') {
      const arg = node.arguments?.[0];
      if (arg && typeof arg.value === 'string') imports.add(arg.value);
    }

    if (node.type === 'ExportAllDeclaration') {
      exports.add('*');
      if (node.source?.value) imports.add(node.source.value);
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
      if (node.source?.value) imports.add(node.source.value);
    }

    if (node.type === 'ExportDefaultDeclaration') {
      if (node.declaration?.id?.name) exports.add(node.declaration.id.name);
      if (node.declaration?.type === 'Identifier' && node.declaration.name) {
        exports.add(node.declaration.name);
      }
      exports.add('default');
    }

    if (node.type === 'TSImportEqualsDeclaration') {
      const value = node.moduleReference?.expression?.value;
      if (typeof value === 'string') imports.add(value);
    }

    if (node.type === 'AssignmentExpression') {
      const left = getMemberName(node.left);
      if (left === 'module.exports') exports.add('default');
      if (left && left.startsWith('exports.')) exports.add(left.slice('exports.'.length));
    }

    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const calleeName = getCalleeName(node.callee);
      const callerName = functionStack.length ? functionStack[functionStack.length - 1] : '(module)';
      if (calleeName) {
        calls.push([callerName, calleeName]);
        const args = Array.isArray(node.arguments)
          ? node.arguments.map((arg) => truncateCallText(formatCallArg(arg))).filter(Boolean).slice(0, MAX_CALL_ARGS)
          : [];
        const location = resolveCallLocation(node);
        const calleeParts = resolveCalleeParts(calleeName);
        const detail = {
          caller: callerName,
          callee: calleeName,
          calleeRaw: calleeParts.calleeRaw || calleeName,
          calleeNormalized: calleeParts.calleeNormalized || calleeName,
          receiver: calleeParts.receiver || null,
          args
        };
        if (location) {
          detail.start = location.start;
          detail.end = location.end;
          detail.startLine = location.startLine;
          detail.startCol = location.startCol;
          detail.endLine = location.endLine;
          detail.endCol = location.endCol;
        }
        callDetails.push(detail);
      }
    }

    if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') {
      recordControl('branches');
    }
    if (node.type === 'SwitchStatement') {
      const count = Array.isArray(node.cases) && node.cases.length ? node.cases.length : 1;
      recordControl('branches', count);
    }
    if (node.type === 'TryStatement') {
      recordControl('branches');
    }
    if (node.type === 'CatchClause') {
      recordControl('branches');
    }
    if (node.type === 'ForStatement'
      || node.type === 'ForInStatement'
      || node.type === 'ForOfStatement'
      || node.type === 'WhileStatement'
      || node.type === 'DoWhileStatement') {
      recordControl('loops');
    }
    if (node.type === 'BreakStatement') {
      recordControl('breaks');
    }
    if (node.type === 'ContinueStatement') {
      recordControl('continues');
    }

    if (node.type === 'Identifier') {
      usages.add(node.name);
      if (shouldCountRead(node, parent)) {
        recordRead(node.name);
      }
    }

    if (node.type === 'VariableDeclarator' && node.id) {
      recordPatternWrite(node.id);
      if (node.id.type === 'Identifier' && node.init) {
        const target = getMemberName(node.init);
        if (target) recordAlias(node.id.name, target);
      }
    }

    if (node.type === 'AssignmentExpression' && node.left) {
      if (node.left.type === 'Identifier') {
        recordWrite(node.left.name);
        const target = getMemberName(node.right);
        if (target) recordAlias(node.left.name, target);
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

  const ast = options.ast || parseJavaScriptAst(text, options);
  if (ast) {
    walk(ast, null);
  }
  const astTokens = Array.isArray(ast?.tokens) ? ast.tokens : null;
  if (astTokens && astTokens.length) {
    for (const token of astTokens) {
      const label = token?.type?.label || token?.type;
      if (label === 'name' || label === 'Identifier' || label === 'jsxName') {
        const value = token.value || token.name;
        if (value) usages.add(value);
      }
    }
  } else {
    try {
      const tokens = esprima.tokenize(text, { tolerant: true });
      tokens.forEach((t) => {
        if (t.type === 'Identifier') usages.add(t.value);
      });
    } catch {}
  }

  if (dataflowEnabled || controlFlowEnabled) {
    for (const [name, flow] of flowByName.entries()) {
      const meta = functionMeta[name] || {};
      if (dataflowEnabled) {
        meta.dataflow = {
          reads: Array.from(flow.reads),
          writes: Array.from(flow.writes),
          mutations: Array.from(flow.mutations),
          aliases: Array.from(flow.aliases)
        };
        meta.throws = Array.from(flow.throws);
        meta.awaits = Array.from(flow.awaits);
        meta.returnsValue = !!flow.returns;
        meta.yields = !!flow.yields;
        meta.modifiers = meta.modifiers || {};
        meta.modifiers.generator = !!flow.yields;
      }
      if (controlFlowEnabled && flow.controlFlow) {
        meta.controlFlow = { ...flow.controlFlow };
      }
      functionMeta[name] = meta;
    }
  }

  return {
    imports: Array.from(imports),
    exports: Array.from(exports),
    calls,
    callDetails,
    usages: Array.from(usages),
    functionMeta,
    classMeta
  };
}
