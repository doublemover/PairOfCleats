import { createJavaScriptDeclarationCatalog } from './callable-occurrences.js';
import { callableEvaluationChildren } from './evaluation-children.js';
import { throwIfAborted } from '../../shared/abort.js';
import { createJavaScriptImportResult } from './import-extraction.js';
import { projectJsTsCallArguments } from '../js-ts/call-arguments.js';
import { projectBabelCallable } from '../js-ts/callable-metadata.js';
import { projectJsTsLiteral, collectCallLiteralEvidence } from '../js-ts/literal.js';
import { collectConstantReferences } from '../js-ts/constant-references.js';
import { createReturnCallEvidence } from '../js-ts/return-call-evidence.js';
import { recordJsTsImportBindings } from '../js-ts/import-bindings.js';
import * as esprima from 'esprima';
import {
  collectPatternNames,
  formatDefault,
  formatParam,
  keyName,
  visibilityFor
} from './ast-utils.js';
import { parseJavaScriptAst, ownsJavaScriptSyntaxText, getJavaScriptSyntaxIdentity } from './parse.js';
import {
  buildCallDetail,
  formatJsTsCallArg,
  resolveAstMemberName,
  resolveCallLocation,
  truncateCallText
} from '../js-ts/relations-shared.js';

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
const OWN_HAS = Object.prototype.hasOwnProperty;

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
  const flowByOwner = new Map();
  let activeOwner = null, activeEvaluationPhase = 'invocation-body';
  const classStack = [];

  const ast = options.ast || parseJavaScriptAst(text, options);
  const sourceOwned = ownsJavaScriptSyntaxText(ast, text);
  const declarationOwner = createJavaScriptDeclarationCatalog(ast, text);
  const declarations = declarationOwner.catalog;
  declarations.analysis = { dataflow: dataflowEnabled, controlFlow: controlFlowEnabled };
  const moduleRecord = text.length ? declarationOwner.add({ type: 'ModuleEvaluation', start: 0, end: text.length }, null,
    { displayName: '(module)', kind: 'module', metadata: {} }) : null;
  const returnEvidence = createReturnCallEvidence(ast, { sourceOwned });
  const constants = collectConstantReferences(ast);
  const getMemberName = (node) => resolveAstMemberName(node, { constantKeys: constants.keys });

  const getCalleeName = (callee) => {
    if (!callee) return null;
    if (callee.type === 'ChainExpression') return getCalleeName(callee.expression);
    if (callee.type === 'OptionalCallExpression') return getCalleeName(callee.callee);
    if (callee.type === 'Import') return null;
    if (callee.type === 'Identifier') return constants.aliases.get(callee) || callee.name;
    if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
      return getMemberName(callee);
    }
    if (callee.type === 'Super') return 'super';
    return null;
  };

  const currentFunction = () => activeOwner;

  const ensureFlow = (ownerId, phase = activeEvaluationPhase) => {
    const name = ownerId + '/' + phase;
    if (!flowByOwner.has(name)) {
      flowByOwner.set(name, { ownerId, phase,
        reads: new Set(),
        writes: new Set(),
        mutations: new Set(),
        aliases: new Set(),
        throws: new Set(),
        awaits: new Set(),
        returns: false,
        yields: false,
        controlFlow: controlFlowEnabled ? { branches: 0, loops: 0, returns: 0, implicitReturns: 0, throws: 0, awaits: 0, yields: 0, breaks: 0, continues: 0 } : null
      });
    }
    return flowByOwner.get(name);
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

  const recordReturn = (hasValue) => {
    recordControl('returns');
    if (!dataflowEnabled) return;
    const scope = currentFunction();
    if (!scope) return;
    if (hasValue) ensureFlow(scope).returns = true;
  };

  const recordYield = () => {
    recordControl('yields');
    if (!dataflowEnabled) return;
    const scope = currentFunction();
    if (!scope) return;
    ensureFlow(scope).yields = true;
  };

  const inferFunctionName = (node, parent) => {
    if (parent && parent.type === 'VariableDeclarator' && parent.id?.name) return parent.id.name;
    if (node.id && node.id.name) return node.id.name;
    if (parent && parent.type === 'AssignmentExpression') {
      const left = getMemberName(parent.left);
      if (left) return left;
    }
    if (node.type === 'ObjectMethod' && node.key) return keyName(node.key) || '(anonymous)';
    if ((node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') && node.key) {
      const propName = keyName(node.key);
      const className = classStack.at(-1)?.displayName;
      return className ? `${className}.${propName}` : propName;
    }
    if (parent && (parent.type === 'Property' || parent.type === 'PropertyDefinition') && parent.key) {
      const propName = keyName(parent.key);
      const className = parent.type === 'PropertyDefinition' ? classStack.at(-1)?.displayName : null;
      return className ? `${className}.${propName}` : propName;
    }
    if (parent && (parent.type === 'ObjectProperty' || parent.type === 'ClassProperty'
      || parent.type === 'ClassPrivateProperty') && parent.key) {
      const propName = keyName(parent.key);
      const className = parent.type === 'ObjectProperty' ? null : classStack.at(-1)?.displayName;
      return className ? `${className}.${propName}` : propName;
    }
    if (parent && parent.type === 'MethodDefinition' && parent.key) {
      const propName = keyName(parent.key);
      const className = classStack.at(-1)?.displayName;
      return className ? `${className}.${propName}` : propName;
    }
    return '(anonymous)';
  };

  const MAX_PARAM_NAMES = 256;
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
    const paramDefaults = Object.create(null);
    const paramDefaultLiterals = Object.create(null);
    if (!node?.params) {
      return {
        params,
        paramNames,
        stableParamNames,
        paramDefaults, paramDefaultLiterals
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
          const literal = sourceOwned && !ast.errors?.length ? projectJsTsLiteral(param.right, text) : null;
          if (literal) paramDefaultLiterals[name] = literal;
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
      paramDefaults, paramDefaultLiterals
    };
  };

  const buildSignature = (node, name, params) => {
    const paramsStr = params.join(', ');
    if (node.type === 'ArrowFunctionExpression') {
      return `(${paramsStr}) =>`;
    }
    const fnName = name && name !== '(anonymous)' ? ` ${name}` : '';
    return `function${fnName}(${paramsStr})`;
  };

  const registerFunctionMeta = (node, parent) => {
    const name = inferFunctionName(node, parent);
    const { params, paramNames, stableParamNames, paramDefaults, paramDefaultLiterals } = collectParamMeta(node);
    const signature = buildSignature(node, name, params);
    const callableParameters = sourceOwned ? projectBabelCallable({ node, text, start: node.start, end: node.end,
      parseComplete: !ast.errors?.length, language: 'javascript', parser: `javascript-${getJavaScriptSyntaxIdentity(ast)?.family}` }).callableParameters : null;
    const modifiers = {
      async: !!node.async,
      generator: !!node.generator,
      static: false,
      visibility: visibilityFor(name.split('.').pop() || name)
    };
    let methodKind = null;
    if (parent && (parent.type === 'MethodDefinition' || parent.type === 'Property' && (parent.method || ['get', 'set'].includes(parent.kind)))) {
      modifiers.static = !!parent.static;
      methodKind = parent.kind === 'init' && parent.method ? 'method' : parent.kind || null;
      const key = keyName(parent.key);
      modifiers.visibility = visibilityFor(key);
    }
    if (node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod' || node.type === 'ObjectMethod') {
      modifiers.static = !!node.static;
      methodKind = node.kind || null;
      const key = keyName(node.key);
      modifiers.visibility = visibilityFor(key);
    }
    if (['ClassProperty', 'ClassPrivateProperty', 'PropertyDefinition'].includes(parent?.type)) modifiers.static = parent.static === true;
    if (['PrivateName', 'PrivateIdentifier'].includes(node.key?.type || parent?.key?.type)) modifiers.visibility = 'private';
    const metadata = {
      params: paramNames, paramNames: stableParamNames, paramDefaults, paramDefaultLiterals, callableParameters,
      signature, modifiers, methodKind, returnType: null
    };
    if (node.key || parent?.key) metadata.memberBinding = { computed: Boolean(node.computed || parent?.computed),
      private: ['PrivateName', 'PrivateIdentifier'].includes(node.key?.type || parent?.key?.type), static: modifiers.static };
    const classMember = ['ClassMethod', 'ClassPrivateMethod'].includes(node.type) || parent?.type === 'MethodDefinition';
    const record = declarationOwner.add(node, parent, { displayName: name, parentId: classMember ? classStack.at(-1)?.id || activeOwner : activeOwner, metadata });
    if (record) { record.scopeState = 'pending'; record.scopeReasons = []; }
    return record;
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
  const walk = (root) => {
    const stack = [{ node: root, parent: null, phase: 0, exitType: null, returnOwner: null, ownerId: moduleRecord?.id || null, evaluationPhase: 'module-evaluation' }];
    const pushFrame = frame => {
      if (stack.length >= declarations.coverage.maxQueuedSteps) {
        declarationOwner.partial('traversal_queue_limit');
        const record = declarations.records[frame.ownerId];
        if (record?.kind === 'callable' && !record.scopeReasons.includes('traversal_queue_limit')) record.scopeReasons.push('traversal_queue_limit');
        return false;
      }
      stack.push(frame); return true;
    };
    while (stack.length) {
      if (declarations.coverage.visitedSteps >= declarations.coverage.maxTraversalSteps) { declarationOwner.partial('traversal_step_limit'); break; }
      declarations.coverage.visitedSteps++;
      if ((declarations.coverage.visitedSteps & 511) === 0) throwIfAborted(options.abortSignal || options.signal);
      const frame = stack.pop();
      activeOwner = frame.ownerId ?? null;
      activeEvaluationPhase = frame.evaluationPhase || 'invocation-body';
      const { node, parent, phase, exitType } = frame;
      if (!node) continue;
      if (phase === 1) {
        if (exitType === 'class') classStack.pop();
        if (exitType === 'function') {
          const record = declarations.records[frame.ownerId];
          if (record) record.scopeState = record.scopeReasons.length ? 'partial' : 'complete';
        }
        continue;
      }
      if (Array.isArray(node)) {
        const admitted = Math.min(node.length, Math.max(0, declarations.coverage.maxQueuedSteps - stack.length));
        if (admitted < node.length) {
          declarationOwner.partial('traversal_queue_limit');
          const record = declarations.records[activeOwner];
          if (record?.kind === 'callable' && !record.scopeReasons.includes('traversal_queue_limit')) record.scopeReasons.push('traversal_queue_limit');
        }
        for (let i = admitted - 1; i >= 0; i -= 1) {
          pushFrame({ node: node[i], parent, phase: 0, exitType: null, returnOwner: frame.returnOwner, ownerId: activeOwner, evaluationPhase: activeEvaluationPhase, conditional: frame.conditional });
        }
        continue;
      }
      if (typeof node !== 'object') continue;
      const returnOwner = returnEvidence.enter(node, parent, frame.returnOwner);

      if (node.type === 'ImportDeclaration') {
        if (node.source?.value) imports.add(node.source.value);
        for (const specifier of node.specifiers || []) if (specifier?.local?.name) usages.add(specifier.local.name);
        recordJsTsImportBindings(node, parent, importBindings, sourceOwned && !ast.errors?.length);
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

      if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression'
        || node.type === 'NewExpression') {
        const calleeName = getCalleeName(node.callee);
        const callerName = declarations.records[activeOwner]?.displayName || '(module)';
        if (calleeName) {
          if (node.type !== 'NewExpression' && activeOwner) calls.push([activeOwner, calleeName]);
          const args = [];
          if (Array.isArray(node.arguments)) {
            for (let i = 0; i < node.arguments.length && args.length < MAX_CALL_ARGS; i += 1) {
              const value = truncateCallText(formatJsTsCallArg(node.arguments[i], {
                getCalleeName,
                getMemberName
              }), MAX_CALL_ARG_LEN);
              if (value) args.push(value);
            }
          }
          const location = resolveCallLocation(node);
          const detail = buildCallDetail({ callerName, calleeName, args, location });
          detail.callerOccurrenceId = activeOwner;
          detail.evaluationPhase = activeEvaluationPhase;
          detail.conditional = frame.conditional === true;
          const declaration = declarations.records[activeOwner];
          if (declaration) {
            detail.callerDeclaration = { id: declaration.id, sourceHash: declaration.sourceHash, range: declaration.range,
              role: declaration.role, associations: declaration.associations };
            detail.evaluationOwner = { schemaVersion: 1, occurrenceId: declaration.id, sourceHash: declaration.sourceHash,
              ownerRange: declaration.range, phase: activeEvaluationPhase, conditional: detail.conditional,
              state: declarations.source.state, invocationKind: node.type === 'NewExpression' ? 'construct' : 'call',
              sourceOffset: 0,
              meaning: 'potential-source-syntax-within-owner-phase' };
          }
          if (sourceOwned && !ast.errors?.length) {
            detail.argLiterals = collectCallLiteralEvidence(node.arguments, text);
            detail.arguments = projectJsTsCallArguments(node.arguments, text);
          }
          const returnedValue = returnEvidence.get(node);
          if (returnedValue) detail.returnedValue = returnedValue;
          const lexicalBinding = sourceOwned && !ast.errors?.length ? constants.callRoots.get(node) : null;
          if (lexicalBinding?.root === calleeName.split(/::|\./u)[0]) detail.lexicalBinding = lexicalBinding;
          if (node.type === 'NewExpression') detail.role = 'constructor';
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
        recordReturn(Boolean(node.argument));
      }

      if (node.type === 'ThrowStatement') {
        const thrown = getThrownName(node.argument);
        recordThrow(thrown);
      }

      if (node.type === 'AwaitExpression') {
        const awaited = getAwaitName(node.argument);
        recordAwait(awaited);
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

      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        const className = node.id?.name || (parent?.type === 'VariableDeclarator' ? parent.id?.name : null) || '(anonymous-class)';
        const extendsName = getMemberName(node.superClass);
        const metadata = { extends: extendsName ? [extendsName] : [], modifiers: { visibility: visibilityFor(className) } };
        const record = declarationOwner.add(node, parent, { displayName: className, parentId: activeOwner, metadata, kind: 'class' });
        classStack.push(record || { displayName: className });
        pushFrame({ node, parent, phase: 1, exitType: 'class' });
        if (node.body?.body) pushFrame({ node: node.body.body, parent: node, phase: 0, returnOwner, ownerId: activeOwner, evaluationPhase: 'definition-evaluation', conditional: frame.conditional });
        if (node.superClass) pushFrame({ node: node.superClass, parent: node, phase: 0, returnOwner, ownerId: activeOwner, evaluationPhase: 'definition-evaluation', conditional: frame.conditional });
        if (node.decorators?.length) declarationOwner.partial('class_decorator_evaluation_unqualified');
        continue;
      }

      if (['PropertyDefinition', 'ClassProperty', 'ClassPrivateProperty', 'ClassAccessorProperty', 'StaticBlock'].includes(node.type)) {
        const phaseName = node.static || node.type === 'StaticBlock' ? 'class-static-initialization' : 'class-instance-initialization';
        const record = declarationOwner.add(node, parent, { displayName: `${classStack.at(-1)?.displayName || '(class)'}.<${phaseName}@${node.start ?? node.range?.[0]}>`,
          parentId: classStack.at(-1)?.id || activeOwner, kind: 'evaluation', metadata: { evaluationPhase: phaseName } });
        if (record && (node.value || node.body)) pushFrame({ node: node.value || node.body, parent: node, phase: 0,
          ownerId: record.id, evaluationPhase: phaseName, returnOwner: null });
        if (node.computed && node.key) pushFrame({ node: node.key, parent: node, phase: 0, ownerId: activeOwner,
          evaluationPhase: 'definition-evaluation', returnOwner: frame.returnOwner, conditional: frame.conditional });
        if (node.decorators?.length) declarationOwner.partial('class_field_decorator_evaluation_unqualified');
        continue;
      }

      if (node.type === 'MethodDefinition' || ['Property', 'ObjectProperty'].includes(node.type) && parent?.type === 'ObjectExpression') {
        if (node.value) pushFrame({ node: node.value, parent: node, phase: 0, ownerId: activeOwner,
          evaluationPhase: activeEvaluationPhase, returnOwner, conditional: frame.conditional });
        if (node.computed && node.key) pushFrame({ node: node.key, parent: node, phase: 0, ownerId: activeOwner,
          evaluationPhase: 'definition-evaluation', returnOwner, conditional: frame.conditional });
        continue;
      }

      if (isFunctionNode(node)) {
        const record = registerFunctionMeta(node, parent), descriptor = callableEvaluationChildren(node, parent);
        if (!record) continue;
        if (descriptor.unsupported) declarationOwner.partial('decorator_evaluation_unqualified');
        if (descriptor.partialParameters) { declarationOwner.partial('parameter_expression_coverage_incomplete'); record.scopeReasons.push('parameter_expression_coverage_incomplete'); }
        pushFrame({ node, parent, phase: 1, exitType: 'function', ownerId: record.id });
        if (dataflowEnabled || controlFlowEnabled) {
          const flow = ensureFlow(record.id, 'invocation-body');
          if (descriptor.implicitValueReturn) {
            if (dataflowEnabled) flow.returns = true;
            if (controlFlowEnabled) { flow.controlFlow ||= {}; flow.controlFlow.implicitReturns = 1; }
          }
        }
        const children = [...descriptor.definition.map(child => ({ ...child, ownerId: activeOwner, returnOwner: frame.returnOwner, conditional: frame.conditional === true || child.conditional })),
          ...descriptor.parameters.map(child => ({ ...child, ownerId: record.id, returnOwner })),
          ...(descriptor.body ? [{ ...descriptor.body, ownerId: record.id, returnOwner }] : [])];
        for (let i = children.length - 1; i >= 0; i--) pushFrame({ ...children[i], phase: 0 });
        continue;
      }

      for (const key in node) {
        if (!OWN_HAS.call(node, key)) continue;
        if (WALK_SKIP_KEYS.has(key)) continue;
        const child = node[key];
        if (child && typeof child === 'object') {
          pushFrame({ node: child, parent: node, phase: 0, exitType: null, returnOwner, ownerId: activeOwner, evaluationPhase: activeEvaluationPhase, conditional: frame.conditional });
        }
      }
    }
  };

  if (ast) {
    throwIfAborted(options.abortSignal || options.signal);
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

  for (const flow of flowByOwner.values()) {
    const record = declarations.records[flow.ownerId];
    if (!record) continue;
    const values = {};
    if (dataflowEnabled) {
      values.dataflow = { reads: [...flow.reads], writes: [...flow.writes], mutations: [...flow.mutations], aliases: [...flow.aliases] };
      values.throws = [...flow.throws]; values.awaits = [...flow.awaits]; values.returnsValue = flow.returns; values.yields = flow.yields;
    }
    if (controlFlowEnabled && flow.controlFlow) values.controlFlow = { ...flow.controlFlow };
    if (flow.phase === 'invocation-body') Object.assign(record.metadata, values);
    else (record.metadata.evaluationFlows ||= {})[flow.phase] = values;
  }
  for (const record of Object.values(declarations.records)) if (record.scopeState === 'pending') {
    record.scopeState = 'partial'; record.scopeReasons.push('callable_traversal_unfinished');
  }
  for (const [name, ids] of Object.entries(declarations.nameOwners)) {
    if (ids.length !== 1) continue;
    const record = declarations.records[ids[0]];
    if (record.kind === 'callable') functionMeta[name] = record.metadata;
    else if (record.kind === 'class') classMeta[name] = record.metadata;
  }
  callDetails.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0));

  const importResult = createJavaScriptImportResult({ entries: Array.from(imports), text, ast,
    signal: options.abortSignal || options.signal });
  return {
    imports: importResult.entries,
    importExtraction: importResult.receipt,
    exports: Array.from(exports),
    calls,
    callDetails,
    usages: Array.from(usages),
    functionMeta,
    classMeta,
    jsDeclarations: declarations,
    callOwnership: 'javascript-declaration-occurrences-v1',
    importBindings: Object.keys(importBindings).length ? importBindings : null
  };
}
