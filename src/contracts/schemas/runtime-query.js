import { semanticObject as object, semanticInteger as integer, semanticHashSchema as hash,
  semanticNullable as nullable, SEMANTIC_GENERATION_SCHEMA } from './semantic-envelopes.js';
import { SEMANTIC_RECORD_REF_SCHEMA } from './semantic.js';
import { RUNTIME_EVIDENCE_SCHEMA, RUNTIME_CAPTURE_MANIFEST_SCHEMA } from './runtime-evidence.js';
const text = { type: 'string', minLength: 1, maxLength: 4096 };
const list = (items, maxItems = 32) => ({ type: 'array', items, maxItems, uniqueItems: true });
const source = object({ sourceUnitId: { type: 'string', pattern: '^su1:[a-f0-9]{64}$' }, byteHash: hash });
const code = object({ sessionId: text, processId: text, codeId: text, lifetimeId: text });
const kinds = { enum: ['cpuProfile', 'scriptMetadata', 'typeObservation', 'icEvent', 'mapEvent', 'compilerFeedback',
  'codeVersion', 'codeLifecycle', 'sourceMapping', 'optimization', 'deoptimization', 'nativeDisassembly',
  'wasmBytecode', 'counter', 'transfer', 'wait', 'derivedClaim'] };
const quality = { enum: ['exact-source', 'source-map', 'heuristic', 'ambiguous', 'unresolved'] };
const phase = { enum: ['warmup', 'capture', 'mixed', 'unknown'] };
export const RUNTIME_QUERY_SELECTORS_SCHEMA = object({ captureIds: list(text),
  runtime: nullable(object({ executableHash: hash, nodeVersion: text, v8Version: text, os: text, architecture: text })),
  workload: nullable(object({ fingerprint: hash, phase })),
  scope: nullable(object({ sessionId: text, processId: text, isolateId: nullable(text), workerId: nullable(text) })),
  sources: list(source), records: list(SEMANTIC_RECORD_REF_SCHEMA), codeVersions: list(code), evidenceIds: list(text),
  kinds: list(kinds), joinQualities: list(quality)
});
export const RUNTIME_QUERY_LIMITS_SCHEMA = object({ maxRecords: { type: 'integer', minimum: 1, maximum: 128 },
  maxBytes: { type: 'integer', minimum: 4096, maximum: 1048576 }, maxMs: { type: 'integer', minimum: 1, maximum: 1000 } });
export const RUNTIME_QUERY_REQUEST_SCHEMA = object({ schemaVersion: { const: 1 }, repositoryNamespace: text,
  generation: SEMANTIC_GENERATION_SCHEMA, familyGenerations: { ...list(hash), minItems: 1 },
  selectors: RUNTIME_QUERY_SELECTORS_SCHEMA, limits: RUNTIME_QUERY_LIMITS_SCHEMA,
  cursor: nullable({ type: 'string', minLength: 1, maxLength: 4096 }) });
const observation = { allOf: [RUNTIME_EVIDENCE_SCHEMA, { type: 'object', properties: { evidenceClass: { const: 'observed' } } }] };
const claim = { allOf: [RUNTIME_EVIDENCE_SCHEMA, { type: 'object', properties: { evidenceClass: { const: 'inferred' } } }] };
const next = object({ question: text, evidenceKinds: list(kinds), expectedInformationGain: text,
  estimatedCost: text, permissionRequirements: list(text), action: { const: 'plan-only' }, executionAuthorized: { const: false } });
export const RUNTIME_QUERY_RESULT_SCHEMA = object({ schemaVersion: { const: 1 }, queryId: hash,
  executionAuthorized: { const: false }, repositoryNamespace: text, generation: SEMANTIC_GENERATION_SCHEMA,
  pinnedFamilies: list(object({ generationId: hash, captureId: text, manifestHash: hash })),
  observations: { type: 'array', maxItems: 128, items: observation }, derivedClaims: { type: 'array', maxItems: 128, items: claim },
  derivedCoverage: object({ state: { const: 'unsupported' }, reason: { const: 'current_saved_adapters_project_direct_observations_only' } }),
  explanations: { type: 'array', maxItems: 128, items: object({ evidenceIds: list(text), statement: text,
    basis: { enum: ['direct-observation', 'derived-claim'] }, limitations: list(text), nextObservation: nullable(next) }) },
  coverage: list(object({ generationId: hash, captureId: text, completion: { enum: ['complete', 'partial', 'failed', 'cancelled'] },
    selected: { type: 'boolean' }, formats: list(text, 128), importStates: list({ enum: ['complete', 'partial', 'unsupported', 'malformed'] }, 4),
    sourceJoinCounts: object({ exactSource: integer, sourceMap: integer, heuristic: integer, ambiguous: integer, unresolved: integer }),
    joinStatus: { enum: ['not-filtered', 'exact-source-requested', 'record-reference-requested'] }, reasons: list(text) })),
  omitted: { type: 'array', maxItems: 128, items: object({ generationId: hash, evidenceId: text, reason: text }) },
  status: { enum: ['complete', 'partial'] }, warnings: list(text), nextCursor: nullable({ type: 'string', maxLength: 4096 }),
  integrity: object({ manifest: { const: 'verified' }, queryIndex: { const: 'verified' }, returnedRows: { const: 'verified' }, rawArtifacts: { const: 'not-read' } }),
  cost: object({ visitedRecords: integer, hydratedRecords: integer, elapsedMs: integer, responseBytes: integer })
});

export const RUNTIME_QUERY_CURSOR_SCHEMA = object({ version: { const: 1 }, queryId: hash,
  familyIndex: { type: 'integer', minimum: 0, maximum: 32 }, ordinal: integer, checksum: hash });

export const RUNTIME_LOOKUP_SERVICE_REQUEST_SCHEMA = object({ schemaVersion: { const: 1 }, repoRoot: text,
  destination: text, request: RUNTIME_QUERY_REQUEST_SCHEMA });
export const RUNTIME_DISCOVERY_SERVICE_REQUEST_SCHEMA = object({ schemaVersion: { const: 1 }, repoRoot: text, destination: text,
  limits: object({ maxFamilies: { type: 'integer', minimum: 1, maximum: 32 },
    maxScan: { type: 'integer', minimum: 1, maximum: 100000 }, maxBytes: { type: 'integer', minimum: 4096, maximum: 1048576 },
    maxMs: { type: 'integer', minimum: 1, maximum: 1000 } }), cursor: nullable({ type: 'string', minLength: 1, maxLength: 4096 }) });
const captureProperties = RUNTIME_CAPTURE_MANIFEST_SCHEMA.properties;
export const RUNTIME_DISCOVERY_RESULT_SCHEMA = object({ schemaVersion: { const: 1 }, executionAuthorized: { const: false },
  families: list(object({ generationId: hash, captureId: text, manifestHash: hash, repositoryNamespace: text,
    queryIndexState: { enum: ['available', 'unavailable-reingest'] },
    generation: SEMANTIC_GENERATION_SCHEMA, sources: captureProperties.sources, runtime: captureProperties.runtime,
    workload: captureProperties.workload, scope: captureProperties.scope, completion: captureProperties.completion })),
  nextCursor: nullable({ type: 'string', maxLength: 4096 }), scannedDirectories: integer, warnings: list(text) });
