import * as esprima from 'esprima';
import {
  collectPatternNames,
  formatDefault,
  formatParam,
  keyName,
  visibilityFor
} from './ast-utils.js';
import { parseJavaScriptAst } from './parse.js';
import { resolveCalleeParts, resolveCallLocation, truncateCallText } from '../js-ts/relations-shared.js';

/**
 * Build import/export/call/usage relations for JS chunks.
 * @param {string} text
 * @param {string} relPath
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importBindings:Object|null}}
 */
export function buildCodeRelations(text, relPath, options = {}) {
  const dataflowEnabled = options.dataflow !== false;
  const controlFlowEnabled = options.controlFlow !== false;
  const imports = new Set();
  const importBindings = Object.create(null);
  const exports = new Set();
  const calls = [];
  const callDetails = [];
  const usages = new Set();
  const functionMeta = Object.create(null);
  const classMeta = Object.create(null);
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

  const MAX_PARAM_NAMES = 16;
  const resolveStableParamName = (param, index) => {
    if (!param) return `arg${index}`;
    if (param.type === 'Identifier') return param.name;
    if (param.type === 'AssignmentPattern') {
      if (param.left?.type === 'Identifier') return param.left.name;
      return `arg${index}`;
    }
    if (param.type === 'RestElement') {
      if (param.argument?.type === 'Identifier') return param.argument.name;
      return `arg${index}`;
    }
    if (param.type === 'ObjectPattern' || param.type === 'ArrayPattern') return `arg${index}`;
    return `arg${index}`;
  };

  const collectParamMeta = (node) => {
    const params = [];
    const paramNames = [];
    const stableParamNames = [];
    const paramDefaults = {};
    if (!node?.params) {
      return {
        params,
        paramNames,
        stableParamNames,
        paramDefaults
      };
    }
    node.params.forEach((param, index) => {
      params.push(formatParam(param));
      const names = [];
      collectPatternNames(param, names);
      names.forEach((name) => {
        paramNames.push(name);
        if (param.type === 'AssignmentPattern' && param.left?.type === 'Identifier') {
          paramDefaults[name] = formatDefault(param.right);
        }
      });
      if (stableParamNames.length < MAX_PARAM_NAMES) {
        stableParamNames.push(resolveStableParamName(param, index));
      }
    });
    return {
      params,
      paramNames,
      stableParamNames,
      paramDefaults
    };
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
    const hasExisting = Object.prototype.hasOwnProperty.call(functionMeta, name);
    const existing = hasExisting ? functionMeta[name] : null;
    const { paramNames, stableParamNames, paramDefaults } = collectParamMeta(node);
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
    if (!hasExisting) {
      functionMeta[name] = {
        params: paramNames,
        paramNames: stableParamNames,
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
      existing.paramNames = existing.paramNames?.length ? existing.paramNames : stableParamNames;
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

  const WALK_SKIP_KEYS = new Set([
    'loc',
    'start',
    'end',
    'tokens',
    'comments',
    'leadingComments',
    'trailingComments',
    'innerComments',
    'extra',
    'parent'
  ]);

  const walk = (root) => {
    const stack = [{ node: root, parent: null, phase: 0, exitType: null }];
    while (stack.length) {
      const frame = stack.pop();
      const { node, parent, phase, exitType } = frame;
      if (!node) continue;
      if (phase === 1) {
        if (exitType === 'function') functionStack.pop();
        if (exitType === 'class') classStack.pop();
        continue;
      }
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i -= 1) {
          stack.push({ node: node[i], parent, phase: 0, exitType: null });
        }
        continue;
      }
      if (typeof node !== 'object') continue;

      if (node.type === 'ImportDeclaration') {
        if (node.source?.value) imports.add(node.source.value);
        const sourceValue = typeof node.source?.value === 'string' ? node.source.value : null;
        if (sourceValue && Array.isArray(node.specifiers)) {
          node.specifiers.forEach((specifier) => {
            const localName = specifier?.local?.name;
            if (!localName) return;
            if (specifier.type === 'ImportSpecifier') {
              const importedName = specifier.imported?.name || null;
              importBindings[localName] = { imported: importedName || null, module: sourceValue };
              return;
            }
            if (specifier.type === 'ImportDefaultSpecifier') {
              importBindings[localName] = { imported: 'default', module: sourceValue };
              return;
            }
            if (specifier.type === 'ImportNamespaceSpecifier') {
              importBindings[localName] = { imported: '*', module: sourceValue };
            }
          });
        }
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
            ? node.arguments
              .map((arg) => truncateCallText(formatCallArg(arg), MAX_CALL_ARG_LEN))
              .filter(Boolean)
              .slice(0, MAX_CALL_ARGS)
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
        stack.push({ node, parent, phase: 1, exitType: 'class' });
        if (node.body?.body) {
          stack.push({ node: node.body.body, parent: node, phase: 0, exitType: null });
        }
        continue;
      }

      if (isFunctionNode(node)) {
        const fnName = registerFunctionMeta(node, parent);
        functionStack.push(fnName);
        stack.push({ node, parent, phase: 1, exitType: 'function' });
        if (node.body) {
          stack.push({ node: node.body, parent: node, phase: 0, exitType: null });
        }
        continue;
      }

      const keys = Object.keys(node);
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        const key = keys[i];
        if (WALK_SKIP_KEYS.has(key)) continue;
        const child = node[key];
        if (child && typeof child === 'object') {
          stack.push({ node: child, parent: node, phase: 0, exitType: null });
        }
      }
    }
  };

  const ast = options.ast || parseJavaScriptAst(text, options);
  if (ast) {
    walk(ast);
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
      const meta = Object.prototype.hasOwnProperty.call(functionMeta, name)
        ? functionMeta[name]
        : {};
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
    classMeta,
    importBindings: Object.keys(importBindings).length ? importBindings : null
  };
}
