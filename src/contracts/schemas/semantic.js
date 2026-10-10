export const SEMANTIC_SCHEMA_VERSION = 1;
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const text = { type: 'string', minLength: 1 };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const enumeration = (values) => ({ enum: values.split(' ') });
const object = (properties) => ({
  type: 'object', additionalProperties: false, properties, required: Object.keys(properties)
});
export const SEMANTIC_RECORD_REF_SCHEMA = object({
  partitionId: { type: 'string', pattern: '^(sy1|sa1):[a-f0-9]{64}$' },
  localId: integer
});
const ref = SEMANTIC_RECORD_REF_SCHEMA;
const optionalRef = nullable(ref);
const span = { type: 'array', items: integer, minItems: 2, maxItems: 2 };
const flags = { type: 'array', items: text, uniqueItems: true };
const textRef = {
  oneOf: [
    object({ span }),
    object({ blobHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } })
  ]
};
const payloads = {
  scope: object({ scopeKind: text, parent: optionalRef, owner: optionalRef }),
  declaration: object({
    nameId: integer, declarationKind: text, flags, initializer: optionalRef, typeSyntax: optionalRef
  }),
  occurrence: object({
    nameId: integer,
    roles: { type: 'array', uniqueItems: true, minItems: 1,
      items: enumeration('definition reference read write call construct import export property capture') },
    expression: optionalRef, flags
  }),
  statement: object({ astKind: text, statementKind: text, flags }),
  expression: object({
    astKind: text, operation: nullable(text),
    invocationKind: nullable(enumeration('call optionalCall construct tag import')),
    syntacticArgumentCount: nullable(integer), flags
  }),
  literal: object({
    literalKind: text, textRef,
    scalar: nullable(object({ type: text, representation: { type: 'string' } }))
  }),
  type: object({
    origin: enumeration('declared contextual checker-inferred'), textRef, compilerContextKey: nullable(text)
  }),
  binding: object({
    occurrence: ref, contextKey: text,
    status: enumeration('resolved ambiguous heuristic unresolved'), signature: nullable(textRef),
    symbolGroupId: nullable({ type: 'string', pattern: '^sg1:[a-f0-9]{64}$' }), candidateCount: integer
  }),
  block: object({ owner: ref, blockKind: enumeration('entry normal exit exception') }),
  value: object({
    origin: enumeration('parameter definition merge return heap capture unknown'),
    site: ref, storage: optionalRef
  }),
  boundary: object({
    modelId: text, modelVersion: text, invocation: ref, boundaryKind: text,
    fromContext: nullable(text), toContext: nullable(text)
  }),
  externalDeclaration: object({
    contextKey: text, uri: text, packageName: nullable(text), packageVersion: nullable(text),
    nameId: integer, declarationKind: text, sourceHash: nullable(text),
    sourceRange: nullable(object({ coordinateUnit: text, start: integer, end: integer }))
  }),
  evidence: object({
    method: text, producerId: text, producerVersion: text, evidenceKind: text,
    sourceRef: nullable(text), artifactRef: nullable(text)
  })
};
export const SEMANTIC_NODE_SCHEMA = {
  oneOf: Object.entries(payloads).map(([kind, data]) => object({
    id: integer, kind: { const: kind }, span: nullable(span), scope: optionalRef, data
  }))
};
export const SEMANTIC_OPERAND_SCHEMA = object({
  parent: ref,
  slot: { anyOf: [
    enumeration('callee receiver argument parameter typeArgument left right object index condition trueValue falseValue initializer body branch returnValue throwValue awaitValue yieldValue propertyKey propertyValue element'),
    { type: 'string', pattern: '^ast:[A-Za-z][A-Za-z0-9]*\\.[A-Za-z][A-Za-z0-9]*$' }
  ] },
  ordinal: integer, child: optionalRef,
  flags: { type: 'array', uniqueItems: true, items: enumeration('spread computed shorthand optional rest hole') }
});
export const SEMANTIC_EDGE_KINDS = Object.freeze(
  'references aliases defines reads writes mutates returns throws captures flowsTo controlNext controlTrue controlFalse exceptional callTarget constructTarget argumentToParameter returnToResult bindingCandidate sharesStorage copies packs transfers dispatches consumes evidenceInput'.split(' ')
);
export const SEMANTIC_EDGE_SCHEMA = object({
  id: integer, kind: { enum: SEMANTIC_EDGE_KINDS }, from: ref, to: ref,
  callSite: optionalRef, operandOrdinal: nullable(integer), contextKey: nullable(text),
  condition: optionalRef, evidence: optionalRef, certainty: enumeration('exact-static modeled heuristic')
});
export const SEMANTIC_COVERAGE_SCHEMA = object({
  scope: { anyOf: [ref, object({ sourceUnitId: { type: 'string', pattern: '^su1:[a-f0-9]{64}$' } })] },
  phase: enumeration('syntax bindings localFlow crossFileFlow boundaryModels runtimeJoin'),
  state: enumeration('complete partial deferred disabled unsupported failed stale'),
  reason: nullable(text), observedCount: nullable(integer), completedCount: nullable(integer),
  frontierRef: nullable(text)
});
export const SEMANTIC_OWNERSHIP_SCHEMA = object({
  recordRef: ref, chunkUid: text, role: enumeration('primary overlap')
});
export const SEMANTIC_LOOKUP_SCHEMA = object({
  kind: { const: 'name' }, id: integer, value: { type: 'string' }
});
export const SEMANTIC_SCHEMA_DEFS = Object.freeze({
  lookup: SEMANTIC_LOOKUP_SCHEMA, node: SEMANTIC_NODE_SCHEMA, operand: SEMANTIC_OPERAND_SCHEMA,
  edge: SEMANTIC_EDGE_SCHEMA, coverage: SEMANTIC_COVERAGE_SCHEMA,
  ownership: SEMANTIC_OWNERSHIP_SCHEMA, recordRef: SEMANTIC_RECORD_REF_SCHEMA
});
