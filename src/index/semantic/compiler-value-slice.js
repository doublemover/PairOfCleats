import { createAnalysisPartitionId, semanticHash, canonicalSemanticJson } from './identity.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { throwIfAborted } from '../../shared/abort.js';
/** Conservative first value slice: immutable local definitions and verified default-library models.
 * CFG, mutable reaching definitions and dynamic properties remain explicit partial coverage.
 */
export const collectCompilerValueSlice = async ({ ts, checker, sourceFile, nodes, expressionFor,
  observations, source, bytes, bindingPartition, context, isDefaultLibrary, root, policy, diskAccount, signal }) => {
  if (policy.enrichment.localFlow === 'off' || policy.enrichment.localFlow === 'deferred') return null;
  const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-value-slice', version: '2' },
    inputPartitionHashes: [bindingPartition.canonicalHash], compilerContext: context,
    dependencySummaryHashes: [], analysisPolicy: { version: 2, fieldPathDepth: policy.enrichment.fieldPathDepth } });
  const ref = localId => ({ partitionId, localId }), rows = [], edges = [], constants = new Map();
  let id = 0, modeled = 0, unresolved = 0;
  const functionOwners = new WeakMap(), declarationOwners = new Map();
  const ownerOf = node => {
    const pending = [];
    let current = node;
    while (current && !functionOwners.has(current) && !ts.isFunctionLike(current)) { pending.push(current); current = current.parent; }
    const owner = current ? (functionOwners.has(current) ? functionOwners.get(current) : current) : null;
    for (const child of pending) functionOwners.set(child, owner);
    return owner;
  };
  const evidence = ref(id++);
  rows.push({ family: 'node', row: { id: evidence.localId, kind: 'evidence', span: null, scope: null,
    data: { method: 'syntax-and-checker-model', producerId: 'semantic-value-slice', producerVersion: '2',
      evidenceKind: 'modeled', sourceRef: source.sourceUnitId, artifactRef: null } } });
  const edge = (kind, from, to, certainty = 'exact-static', callSite = null, operandOrdinal = null) => {
    if (from && to) edges.push({ kind, from, to, callSite, operandOrdinal, contextKey: context.contextKey,
      condition: null, evidence, certainty });
  };
  // Canonical source preorder, never checker object IDs, determines derived definition IDs.
  for (const node of nodes) {
    throwIfAborted(signal);
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer
      || !(node.parent.flags & ts.NodeFlags.Const)) continue;
    const expression = expressionFor(node.initializer), symbol = checker.getSymbolAtLocation(node.name);
    if (!expression || !symbol) continue;
    const value = ref(id++);
    constants.set(symbol, value);
    declarationOwners.set(symbol, ownerOf(node));
    rows.push({ family: 'node', row: { id: value.localId, kind: 'value',
      span: [node.name.getStart(sourceFile), node.name.end], scope: null,
      data: { origin: 'definition', site: expression, storage: null } } });
    edge('defines', expression, value);
  }
  for (const node of nodes) {
    throwIfAborted(signal);
    const target = expressionFor(node);
    if (!target) continue;
    if (ts.isIdentifier(node)) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
      const value = constants.get(symbol);
      if (value && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)) {
        edge('reads', value, target);
        const owner = ownerOf(node);
        if (owner && owner !== declarationOwners.get(symbol)) edge('captures', value, expressionFor(owner));
      }
    }
    if (ts.isBinaryExpression(node)) {
      // Assignments are not ordinary operands: this slice does not solve mutable reaching definitions.
      if (node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) { unresolved += 1; continue; }
      edge('flowsTo', expressionFor(node.left), target); edge('flowsTo', expressionFor(node.right), target);
    } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      if ([ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) { unresolved += 1; continue; }
      edge('flowsTo', expressionFor(node.operand), target);
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node) || ts.isAwaitExpression(node)) {
      edge('flowsTo', expressionFor(node.expression), target);
    } else if (ts.isPropertyAssignment(node)) edge('packs', expressionFor(node.initializer), target);
    else if (ts.isShorthandPropertyAssignment(node)) edge('packs', expressionFor(node.name), target);
    else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) edge('packs', expressionFor(property), target);
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) if (!ts.isOmittedExpression(element)) edge('packs', expressionFor(element), target);
    } else if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) edge('packs', expressionFor(node.expression), target);
    else if (ts.isReturnStatement(node) && node.expression) edge('returns', expressionFor(node.expression), target);
  }
  for (const observation of observations) {
    if (!observation.invocation) continue;
    const node = observation.node, signature = observation.signatureDeclaration;
    if (!node || !signature || !isDefaultLibrary(signature.getSourceFile())) { unresolved += 1; continue; }
    const target = expressionFor(node), args = node.arguments || [];
    let owner = signature.parent;
    while (owner && !owner.name && !ts.isSourceFile(owner)) owner = owner.parent;
    const ownerName = owner?.name?.text || '';
    const method = signature.name?.text || '';
    const library = signature.getSourceFile().fileName.replaceAll('\\', '/').split('/').pop();
    const typedArray = /^(?:Int|Uint|Uint8Clamped|Float|BigInt|BigUint)/.test(ownerName) && /ArrayConstructor$/.test(ownerName);
    const typedArrayInstance = /^(?:Int|Uint|Float|BigInt|BigUint).*Array$/.test(ownerName);
    const receiver = expressionFor(node.expression?.expression);
    let kind = null;
    if (typedArray && args.length) {
      const inputType = checker.getTypeAtLocation(args[0]);
      const alternatives = inputType.isUnion() ? inputType.types : [inputType];
      const libraryNamed = (type, names) => names.includes(type.symbol?.name)
        && type.symbol?.declarations?.some(d => isDefaultLibrary(d.getSourceFile()));
      if (alternatives.every(type => libraryNamed(type, ['ArrayBuffer', 'SharedArrayBuffer']))) {
        kind = 'typed-array-view'; edge('sharesStorage', expressionFor(args[0]), target, 'modeled', target);
      } else if (alternatives.every(type => checker.isArrayType(type) || checker.isTupleType(type)
        || (/^(?:Int|Uint|Float|BigInt|BigUint).*Array$/.test(type.symbol?.name || '')
          && type.symbol.declarations?.some(d => isDefaultLibrary(d.getSourceFile()))))) {
        kind = 'typed-array-copy'; edge('copies', expressionFor(args[0]), target, 'modeled', target);
      } else unresolved += 1;
    } else if (/^(?:Int|Uint|Float|BigInt|BigUint).*Array$/.test(ownerName) && method === 'subarray') {
      kind = 'typed-array-subarray';
      edge('sharesStorage', expressionFor(node.expression?.expression), target, 'modeled', target);
    } else if (/^(?:Int|Uint|Float|BigInt|BigUint).*Array$/.test(ownerName) && method === 'slice') {
      kind = 'typed-array-slice';
      edge('copies', expressionFor(node.expression?.expression), target, 'modeled', target);
    } else if (typedArrayInstance && method === 'set') {
      kind = 'typed-array-set';
      edge('copies', expressionFor(args[0]), receiver, 'modeled', target, 0);
      edge('mutates', target, receiver, 'modeled', target);
      unresolved += 1; // Offsets, conversion, overlap and bounds remain inputs/preconditions.
    } else if (ownerName === 'DataViewConstructor' && ts.isNewExpression(node)) {
      kind = 'data-view-construction';
      edge('sharesStorage', expressionFor(args[0]), target, 'modeled', target, 0);
      unresolved += 1;
    } else if (ownerName === 'DataView' && /^(get|set)(?:Int|Uint|Float|BigInt|BigUint)\d+$/.test(method)) {
      kind = method.startsWith('get') ? 'data-view-read' : 'data-view-write';
      if (kind === 'data-view-read') edge('reads', receiver, target, 'modeled', target);
      else {
        edge('writes', expressionFor(args[1]), receiver, 'modeled', target, 1);
        edge('mutates', target, receiver, 'modeled', target);
      }
      unresolved += 1; // Byte offset, endianness, conversion and possible RangeError are not erased.
    } else if (['Worker', 'MessagePort', 'DedicatedWorkerGlobalScope'].includes(ownerName) && method === 'postMessage' && library === 'lib.dom.d.ts') {
      kind = 'message-dispatch-request';
    } else if (ownerName === 'Worker' && ts.isNewExpression(node) && library === 'lib.dom.d.ts') kind = 'worker-construction';
    if (!kind) continue;
    modeled += 1;
    const boundary = ref(id++);
    rows.push({ family: 'node', row: { id: boundary.localId, kind: 'boundary', span: [node.getStart(sourceFile), node.end], scope: null,
      data: { modelId: 'typescript-default-library/' + library + '/' + ownerName + '/' + (method || 'construct'),
        modelVersion: '1', invocation: target, boundaryKind: kind, fromContext: 'source:' + source.sourceUnitId, toContext: null } } });
    if (kind.startsWith('typed-array-') || kind.startsWith('data-view-')) {
      // Preserve all ordered layout/conversion inputs, including dynamic offset,
      // length and littleEndian expressions. The exact API is in modelId.
      for (let ordinal = 0; ordinal < args.length; ordinal++) {
        edge('consumes', expressionFor(args[ordinal]), boundary, 'modeled', target, ordinal);
      }
      if (receiver) edge('consumes', receiver, boundary, 'modeled', target);
    }
    if (kind === 'message-dispatch-request') {
      edge('dispatches', target, boundary, 'modeled', target);
      edge('consumes', expressionFor(args[0]), boundary, 'modeled', target, 0);
      if (args[1] && ts.isArrayLiteralExpression(args[1])) {
        for (const element of args[1].elements) {
          if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) { unresolved += 1; continue; }
          edge('transfers', expressionFor(element), boundary, 'modeled', target, 1);
        }
      } else if (args[1]) unresolved += 1;
      // A dispatch request is not an observation of successful delivery, cloning or detachment.
      unresolved += 1;
    }
    if (kind === 'worker-construction') { edge('dispatches', target, boundary, 'modeled', target); unresolved += 1; }
  }
  const sorted = [...new Map(edges.map(row => [canonicalSemanticJson(row), row])).entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  sorted.forEach(([, row], edgeId) => rows.push({ family: 'edge', row: { id: edgeId, ...row } }));
  const coverage = [
    { scope: { sourceUnitId: source.sourceUnitId }, phase: 'localFlow', state: 'partial',
      reason: 'immutable_definition_slice_only_cfg_and_mutable_effects_unresolved', observedCount: null,
      completedCount: constants.size, frontierRef: null },
    { scope: { sourceUnitId: source.sourceUnitId }, phase: 'boundaryModels', state: 'partial',
      reason: 'default_library_models_only_dynamic_realms_and_runtime_delivery_unresolved', observedCount: modeled + unresolved,
      completedCount: modeled, frontierRef: null }
  ];
  for (const row of coverage) rows.push({ family: 'coverage', row });
  const partition = await writeSemanticAnalysis({ rows, policy, stagingRoot: root, source, sourceBytes: bytes, partitionId,
    producerHash: semanticHash('semantic.value-model-producer.v1', { version: 2 }),
    policyHash: semanticHash('semantic.value-model-policy.v1', { fieldPathDepth: policy.enrichment.fieldPathDepth }),
    contextHash: context.contextKey, diskAccount, signal });
  return { partition, coverage };
};
