import { SYMBOLIC_TYPE_GRAPH_SCHEMA } from './symbolic-types.js';

const closed = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const file = { type: 'string', minLength: 1, maxLength: 512,
  pattern: '^(?!.*(?:^|/)(?:\\.\\.?)(?:/|$))(?!/)[^\\\\:\\u0000-\\u001f]+$' };
const paths = { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: file };

/** Internal experimental request surface. No callbacks, handles, raw compiler
 * options or host filesystem layers cross the boundary. Configuration content
 * is admitted as source data; native external-code execution stays disabled. */
export const typescriptApi7RequestSchema = closed({
  schemaVersion: { const: 1 },
  profile: { const: 'typescript-api7-request-snapshot-v1' },
  files: { type: 'array', minItems: 1, maxItems: 128, items: closed({ path: file,
    text: { type: 'string', maxLength: 524288 } }) },
  project: { oneOf: [closed({ kind: { const: 'roots' }, roots: paths }),
    closed({ kind: { const: 'configured' }, configFiles: paths })] },
  queries: { type: 'array', minItems: 1, maxItems: 64, items: closed({
    id: { type: 'string', minLength: 1, maxLength: 128 }, path: file,
    position: { type: 'integer', minimum: 0, maximum: 524288 }, configFile: file
  }, ['id', 'path', 'position']) }
});

const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const string = { type: 'string', maxLength: 16384 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const world = { type: 'string', pattern: '^ts-api7-world-v1:[a-f0-9]{64}$' };
const list = (items, maxItems) => ({ type: 'array', maxItems, items });
const declaration = closed({ path: file, sourceHash: hash, start: integer, end: integer,
  coordinates: { const: 'utf16-full-span' }, syntaxKind: integer, text: { type: 'string', maxLength: 65536 } });
const nativeType = closed({ compilerText: string, flags: integer });
const projectedType = { oneOf: [
  closed({ status: { const: 'unavailable' }, reason: { const: 'native-type-missing' } }),
  closed({ status: { const: 'unknown' }, reason: { const: 'native-error-type' }, native: nativeType }),
  closed({ status: { const: 'native-only' }, native: nativeType, finiteString: { type: 'null' } }),
  closed({ status: { const: 'exact-finite-string' }, native: nativeType,
    finiteString: closed({ contextKey: world, rootId: { type: 'string', pattern: '^tir1:[a-f0-9]{64}$' }, graph: SYMBOLIC_TYPE_GRAPH_SCHEMA }) })
] };
const sourceIdentity = closed({ path: file, sourceHash: hash });
const symbolBase = { name: string, declarations: list(declaration, 128), native: closed({
  flags: integer, documentation: string, jsDocTags: { $ref: '#/$defs/json' } }) };
const symbolTarget = closed({ ...symbolBase, aliasTarget: { type: 'null' } });
const symbol = closed({ ...symbolBase, aliasTarget: nullable({ oneOf: [
  closed({ status: { const: 'unresolved' } }), closed({ status: { const: 'resolved' }, symbol: symbolTarget })
] }) });
const signature = closed({ parameters: list(closed({ symbol: nullable(symbolTarget), type: projectedType }), 64),
  returnType: projectedType, declaration: nullable(declaration), native: closed({ hasRestParameter: { type: 'boolean' },
    isConstruct: { type: 'boolean' }, isAbstract: { type: 'boolean' }, typeParameterCount: integer }) });

export const typescriptApi7WorkerResultSchema = { ...closed({ schemaVersion: { const: 1 },
  profile: { const: 'typescript-api7-request-snapshot-v1' }, requestIdentity: hash,
  worldIdentity: world, snapshotId: integer,
  projects: list(closed({ id: { type: 'string', minLength: 1, maxLength: 1024 }, configFile: nullable(file),
    configFiles: list(sourceIdentity, 128), files: list(sourceIdentity, 128), compilerOptions: { $ref: '#/$defs/json' } }), 32),
  diagnostics: list({ $ref: '#/$defs/diagnostic' }, 2048),
  answers: list(closed({ id: string, worldIdentity: world, projectId: { type: 'string', minLength: 1, maxLength: 1024 },
    path: file, sourceHash: hash, position: integer, symbol: nullable(symbol), type: projectedType, signatures: list(signature, 128) }), 64),
  coverage: closed({ scope: { const: 'supplied-files-only' }, defaultLibraries: { const: 'not-implicitly-mounted' },
    typeDomain: { const: 'exact-finite-string-or-explicit-native-only' }, syntaxSpans: { const: 'utf16-full-span' },
    mixedSnapshotHandles: { const: 'not-admitted' }, bridgeRetirement: { const: 'not-qualified' } }),
  lifecycle: closed({ snapshotDisposed: { const: true }, apiClosed: { const: true } })
}), $defs: {
  json: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }, list({ $ref: '#/$defs/json' }, 128),
    { type: 'object', maxProperties: 128, additionalProperties: { $ref: '#/$defs/json' } }] },
  diagnostic: closed({ path: nullable(file), sourceHash: nullable(hash), start: { type: 'integer' }, end: { type: 'integer' },
    code: integer, category: integer, text: string, projectId: { type: 'string', minLength: 1, maxLength: 1024 },
    phase: { enum: ['configfileparsing', 'program', 'global', 'syntactic', 'bind', 'semantic', 'suggestion'] },
    messageChain: list({ $ref: '#/$defs/diagnosticChild' }, 128), relatedInformation: list({ $ref: '#/$defs/diagnosticChild' }, 128) }),
  diagnosticChild: closed({ path: nullable(file), sourceHash: nullable(hash), start: { type: 'integer' }, end: { type: 'integer' },
    code: integer, category: integer, text: string, messageChain: list({ $ref: '#/$defs/diagnosticChild' }, 128),
    relatedInformation: list({ $ref: '#/$defs/diagnosticChild' }, 128) })
} };
