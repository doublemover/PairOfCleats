import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { throwIfAborted } from '../../../../shared/abort.js';
import { ToolingRequiredComputationError } from '../../required-computation.js';

const DEFAULT_LIMITS = Object.freeze({ maxNodes: 100000, maxDepth: 256,
  maxAliasInstantiations: 10000, maxLiteralBytes: 8388608, maxSourceBytes: 67108864 });

class UnsupportedTypeExpression extends Error {
  constructor(reason, node) {
    super(reason);
    this.reason = reason;
    this.node = node;
  }
}

/**
 * Lower the denotation of closed finite-string annotations before asking the
 * TypeScript checker to instantiate a type. The checker supplies symbol/import
 * identity only. No getTypeFromTypeNode/getDeclaredTypeOfSymbol/type printer is
 * permitted here. Unsupported syntax is an obligation, never an empty language.
 */
export const createFiniteStringFrontend = ({ ts, checker, arena, signal = null, limits: inputLimits = {} }) => {
  if (!ts || !checker || !arena || typeof arena.contextKey !== 'string' || !arena.contextKey) {
    throw new TypeError('A compiler, bound checker and context-owned type IR arena are required.');
  }
  if (!inputLimits || typeof inputLimits !== 'object' || Array.isArray(inputLimits)
    || Object.keys(inputLimits).some(key => !Object.hasOwn(DEFAULT_LIMITS, key))) {
    throw new TypeError('Invalid finite-string frontend limits.');
  }
  const limits = { ...DEFAULT_LIMITS, ...inputLimits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid finite-string frontend ' + name);
  }
  const counts = { nodes: 0, aliasInstantiations: 0, literalBytes: 0, sourceBytes: 0 };
  const sourceCache = new WeakMap(), memo = new Map(), activeAliases = new Set();
  const symbolIds = new WeakMap();
  let nextSymbolId = 0;
  const required = (reason, details = null) => {
    throw new ToolingRequiredComputationError('Finite-string annotation lowering did not complete: ' + reason,
      { operation: 'typescript-finite-string-lowering', reason, details: { contextKey: arena.contextKey, ...details } });
  };
  const addWork = (counter, amount, limit) => {
    counts[counter] += amount;
    if (!Number.isSafeInteger(counts[counter]) || counts[counter] > limits[limit]) {
      required('frontend_' + counter + '_budget', { used: counts[counter], limit: limits[limit] });
    }
  };
  const sourceRef = node => {
    const source = node?.getSourceFile?.();
    if (!source || typeof source.text !== 'string' || typeof source.fileName !== 'string') {
      required('frontend_source_authority_unavailable');
    }
    let identity = sourceCache.get(source);
    if (!identity) {
      addWork('sourceBytes', Buffer.byteLength(source.text, 'utf8'), 'maxSourceBytes');
      identity = { sourceId: pathToFileURL(path.resolve(source.fileName)).href,
        sourceHash: createHash('sha256').update(source.text, 'utf8').digest('hex') };
      sourceCache.set(source, identity);
    }
    return { ...identity, start: node.getStart(source), end: node.getEnd() };
  };
  const unsupported = (reason, node) => { throw new UnsupportedTypeExpression(reason, node); };
  const remember = (dependencies, node) => {
    const ref = sourceRef(node);
    dependencies.set(JSON.stringify(ref), ref);
    return ref;
  };
  const unwrap = node => {
    while (node && ts.isParenthesizedTypeNode(node)) {
      throwIfAborted(signal);
      addWork('nodes', 1, 'maxNodes');
      node = node.type;
    }
    return node;
  };
  const literal = value => {
    addWork('literalBytes', Buffer.byteLength(value, 'utf8'), 'maxLiteralBytes');
    return arena.literal(value, { signal });
  };
  const resolveSymbol = node => {
    let symbol = checker.getSymbolAtLocation(node);
    const seen = new Set();
    while (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      throwIfAborted(signal);
      if (seen.has(symbol)) unsupported('alias_resolution_cycle', node);
      seen.add(symbol);
      addWork('nodes', 1, 'maxNodes');
      symbol = checker.getAliasedSymbol(symbol);
    }
    if (!symbol) unsupported('type_symbol_unresolved', node);
    return symbol;
  };
  const lower = (node, bindings, dependencies, depth) => {
    throwIfAborted(signal);
    if (depth > limits.maxDepth) required('frontend_depth_budget', { depth, limit: limits.maxDepth });
    addWork('nodes', 1, 'maxNodes');
    if (!node) unsupported('explicit_type_annotation_required', node);
    if (node.getSourceFile()?.parseDiagnostics?.length) unsupported('source_parse_diagnostics', node);
    if (ts.isParenthesizedTypeNode(node)) return lower(node.type, bindings, dependencies, depth + 1);
    if (node.kind === ts.SyntaxKind.NeverKeyword) return arena.union([], { signal });
    if (ts.isLiteralTypeNode(node)) {
      if (ts.isStringLiteral(node.literal) || ts.isNoSubstitutionTemplateLiteral(node.literal)) return literal(node.literal.text);
      unsupported('non_string_literal_type', node);
    }
    if (ts.isUnionTypeNode(node)) {
      const children = [];
      for (const type of node.types) children.push(lower(type, bindings, dependencies, depth + 1));
      return arena.union(children, { signal });
    }
    if (ts.isTemplateLiteralTypeNode(node)) {
      const children = [literal(node.head.text)];
      for (const span of node.templateSpans) {
        children.push(lower(span.type, bindings, dependencies, depth + 1), literal(span.literal.text));
      }
      return arena.concat(children, { signal });
    }
    if (!ts.isTypeReferenceNode(node)) unsupported('unsupported_type_syntax:' + ts.SyntaxKind[node.kind], node);
    // Property/namespace type lookup is deliberately outside the initial proof.
    if (!ts.isIdentifier(node.typeName)) unsupported('qualified_type_reference', node);
    const symbol = resolveSymbol(node.typeName);
    if (bindings.has(symbol)) {
      if (node.typeArguments?.length) unsupported('type_parameter_arguments', node);
      return bindings.get(symbol);
    }
    if (symbol.flags & ts.SymbolFlags.TypeParameter) unsupported('unbound_type_parameter', node);
    const declarations = symbol.declarations || [];
    if (declarations.length !== 1 || !ts.isTypeAliasDeclaration(declarations[0])) {
      unsupported('type_alias_declaration_not_unique', node);
    }
    const declaration = declarations[0];
    remember(dependencies, declaration);
    if (activeAliases.has(symbol)) unsupported('recursive_type_alias', node);
    const parameters = declaration.typeParameters || [], argumentsList = node.typeArguments || [];
    if (argumentsList.length > parameters.length
      || parameters.slice(argumentsList.length).some(parameter => !parameter.default)) {
      unsupported('type_alias_argument_arity', node);
    }
    // A finite string is a subtype of string. Other constraints require a
    // separate exact relation evaluator and cannot be guessed from annotation.
    for (const parameter of parameters) {
      if (unwrap(parameter.constraint)?.kind !== ts.SyntaxKind.StringKeyword) {
        unsupported('generic_constraint_not_supported', parameter);
      }
    }
    const nextBindings = new Map(bindings), argumentsRoots = [];
    // Arguments belong to the caller. Box<Box<"x">> is not a recursive alias
    // definition; mark the alias active only while lowering its own body.
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index], argument = argumentsList[index];
      const root = lower(argument || parameter.default, argument ? bindings : nextBindings, dependencies, depth + 1);
      const parameterSymbol = checker.getSymbolAtLocation(parameter.name);
      if (!parameterSymbol || !(parameterSymbol.flags & ts.SymbolFlags.TypeParameter)) {
        unsupported('type_parameter_symbol_unavailable', parameter);
      }
      nextBindings.set(parameterSymbol, root);
      argumentsRoots.push(root.id);
    }
    activeAliases.add(symbol);
    try {
      if (!symbolIds.has(symbol)) symbolIds.set(symbol, nextSymbolId++);
      // Lexically enclosing substitutions matter for local aliases too.
      const bindingKey = [...nextBindings].map(([bound, root]) => {
        if (!symbolIds.has(bound)) symbolIds.set(bound, nextSymbolId++);
        return symbolIds.get(bound) + ':' + root.id;
      }).sort();
      const key = JSON.stringify([symbolIds.get(symbol), argumentsRoots, bindingKey]);
      const cached = memo.get(key);
      if (cached) {
        for (const ref of cached.dependencies) dependencies.set(JSON.stringify(ref), ref);
        return cached.root;
      }
      addWork('aliasInstantiations', 1, 'maxAliasInstantiations');
      const localDependencies = new Map();
      remember(localDependencies, declaration);
      const root = lower(declaration.type, nextBindings, localDependencies, depth + 1);
      const refs = [...localDependencies.values()];
      memo.set(key, { root, dependencies: refs });
      for (const ref of refs) dependencies.set(JSON.stringify(ref), ref);
      return root;
    } finally {
      activeAliases.delete(symbol);
    }
  };
  const attempt = (node, operation) => {
    throwIfAborted(signal);
    try { return operation(); }
    catch (error) {
      if (!(error instanceof UnsupportedTypeExpression)) throw error;
      const ref = sourceRef(error.node || node);
      return { status: 'unsupported', reason: error.reason,
        obligations: [{ reason: error.reason, sourceRef: ref, contextKey: arena.contextKey }] };
    }
  };
  return {
    lowerTypeNode(node) {
      return attempt(node, () => {
        const dependencies = new Map(), input = sourceRef(node);
        const root = lower(node, new Map(), dependencies, 0);
        return { status: 'complete', root, sourceRef: input, dependencies: [...dependencies.values()], contextKey: arena.contextKey };
      });
    },
    lowerFunctionDeclaration(node) {
      return attempt(node, () => {
        if (!ts.isFunctionDeclaration(node) && !ts.isMethodDeclaration(node)) unsupported('function_form_not_supported', node);
        if (node.asteriskToken || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
          unsupported('async_or_generator_signature', node);
        }
        if (node.typeParameters?.length) unsupported('generic_function_signature', node);
        if (node.name && !ts.isIdentifier(node.name)) unsupported('function_name_not_supported', node);
        const symbol = node.name && checker.getSymbolAtLocation(node.name);
        if (!symbol || (symbol.declarations || []).length !== 1) unsupported('overloaded_or_unresolved_function', node);
        if (!node.type) unsupported('inferred_return_type', node);
        const dependencies = new Map(), params = Object.create(null);
        const returnType = lower(node.type, new Map(), dependencies, 0);
        for (const parameter of node.parameters) {
          if (!ts.isIdentifier(parameter.name) || parameter.name.text === 'this') unsupported('parameter_binding_not_supported', parameter);
          if (parameter.questionToken || parameter.dotDotDotToken || parameter.initializer) unsupported('optional_rest_or_default_parameter', parameter);
          if (!parameter.type) unsupported('inferred_parameter_type', parameter);
          if (Object.hasOwn(params, parameter.name.text)) unsupported('duplicate_parameter_name', parameter);
          params[parameter.name.text] = [lower(parameter.type, new Map(), dependencies, 0)];
        }
        return { status: 'complete', returnType, params, declarationRef: sourceRef(node),
          provenance: [...dependencies.values()], contextKey: arena.contextKey };
      });
    },
    stats() { return { ...counts, memoizedAliases: memo.size }; }
  };
};
