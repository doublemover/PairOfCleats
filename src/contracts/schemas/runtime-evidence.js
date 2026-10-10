import { semanticObject as object, semanticInteger as integer, semanticText as text,
  semanticHashSchema as hash, semanticNullable as nullable, SEMANTIC_GENERATION_SCHEMA } from './semantic-envelopes.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref } from './semantic.js';
const list = (items) => ({ type: 'array', items });
const strings = list(text);
const sourceId = { type: 'string', pattern: '^su1:[a-f0-9]{64}$' };
const kinds = { enum: ['cpuProfile', 'scriptMetadata', 'typeObservation', 'icEvent', 'mapEvent',
  'compilerFeedback', 'codeVersion', 'codeLifecycle', 'sourceMapping', 'optimization', 'deoptimization',
  'nativeDisassembly', 'wasmBytecode', 'counter', 'transfer', 'wait', 'derivedClaim'] };
const source = object({ sourceUnitId: sourceId, byteHash: hash });
const selector = object({ sources: list(source), records: list(ref), functions: strings, modules: strings });
const runtime = object({ executableHash: hash, nodeVersion: text, v8Version: text,
  os: text, architecture: text, cpu: nullable(text) });
const scope = object({ sessionId: text, processId: text, isolateId: nullable(text), workerId: nullable(text) });
const clock = object({ domain: text, origin: nullable(text), unit: { enum: ['ns', 'us', 'ms', 'ticks'] },
  alignment: nullable(object({ targetDomain: text, offset: { type: 'number' }, uncertainty: { type: 'number', minimum: 0 } })) });
const workload = object({ fingerprint: hash, inputShapeHash: nullable(hash), phase: { enum: ['warmup', 'capture', 'mixed', 'unknown'] }, description: text });
const limits = object({ durationMs: integer, maxSamples: integer, maxEvents: integer,
  maxBytes: integer, processTreeMemoryBytes: integer, diskReserveBytes: integer });
const producer = object({ id: text, version: text });
const range = object({ start: integer, end: integer, coordinateUnit: { enum: ['utf16', 'utf8-byte', 'wasm-byte', 'native-byte'] } });
const rawRef = object({ artifactId: text, hash, byteRange: nullable(object({ start: integer, end: integer })) });
const timestamp = nullable(object({ clockDomain: text, value: { type: 'number', minimum: 0 } }));
export const RUNTIME_REQUEST_SCHEMA = object({
  schemaVersion: { const: 1 }, requestId: text, question: text, repositoryNamespace: text,
  generation: SEMANTIC_GENERATION_SCHEMA, selectors: selector, workload,
  desiredEvidence: { ...list(kinds), uniqueItems: true }, permittedCollectors: strings,
  limits, expectedCoverage: strings
});
export const RUNTIME_CAPABILITIES_SCHEMA = object({
  schemaVersion: { const: 1 }, runtime, inspectorProtocolHash: nullable(hash), probe: producer,
  capabilities: list(object({ evidenceKind: kinds, collector: text,
    status: { enum: ['supported', 'unsupported', 'requires-restart', 'requires-special-build', 'unknown'] },
    reason: text, flags: strings, methods: strings })), evidenceRefs: strings
});
export const RUNTIME_RAW_ARTIFACT_SCHEMA = object({
  schemaVersion: { const: 1 }, artifactId: text, captureId: text, hash, byteLength: integer,
  format: text, formatVersion: text, mediaType: text, parser: producer,
  retained: { type: 'boolean' }, pinned: { type: 'boolean' }, storageRef: nullable(text)
});
export const RUNTIME_CAPTURE_MANIFEST_SCHEMA = object({
  schemaVersion: { const: 1 }, captureId: text, requestId: text, question: text,
  repositoryNamespace: text, generation: SEMANTIC_GENERATION_SCHEMA, sources: list(source),
  runtime, workload, scope, clock, collector: producer, parser: producer,
  actualFlags: strings, instrumentation: object({ sampling: nullable(text), preciseCoverage: nullable({ type: 'boolean' }),
    debugger: nullable({ type: 'boolean' }), pauses: nullable({ type: 'boolean' }), tracing: strings, perturbation: strings }),
  startedAt: nullable(text), endedAt: nullable(text), limits,
  completion: { enum: ['complete', 'partial', 'failed', 'cancelled'] },
  coverage: strings, warnings: strings, droppedEvents: nullable(integer), rawArtifacts: list(RUNTIME_RAW_ARTIFACT_SCHEMA)
});
const join = object({ quality: { enum: ['exact-source', 'source-map', 'heuristic', 'ambiguous', 'unresolved'] },
  sourceUnitId: nullable(sourceId), sourceHash: nullable(hash), targets: list(ref), reasons: strings,
  sourceMapHash: nullable(hash) });
const codeKey = object({ sessionId: text, processId: text, codeId: text, lifetimeId: text });
const payloads = {
  cpuProfile: object({ profileNodeId: integer, parentNodeId: nullable(integer), functionName: text,
    scriptId: nullable(text), url: nullable(text), lineNumber: nullable(integer), columnNumber: nullable(integer),
    coordinateConvention: { const: 'inspector-zero-based-line-column' }, sampleCount: integer,
    duration: nullable({ type: 'number', minimum: 0 }), deoptReason: nullable(text) }),
  scriptMetadata: object({ scriptId: text, url: nullable(text), contentHash: nullable(hash),
    executionContextId: nullable(text), sourceMapHash: nullable(hash), wasmModuleHash: nullable(hash) }),
  sourceMapping: object({ scriptId: nullable(text), functionId: nullable(text), sourceRange: nullable(range),
    generatedRange: nullable(range), wasmModuleHash: nullable(hash), wasmFunctionIndex: nullable(integer),
    codeVersion: nullable(codeKey), inlinedInto: nullable(codeKey) }),
  typeObservation: object({ site: nullable(text), slot: nullable(text), tags: strings, shapes: strings,
    receiverCategories: strings, count: nullable(integer), sampleMethod: text, window: nullable(object({ start: timestamp, end: timestamp })) }),
  codeVersion: object({ key: codeKey, functionId: nullable(text), moduleHash: nullable(hash), tier: nullable(text),
    architecture: text, codeHash: nullable(hash), disassemblyHash: nullable(hash),
    address: nullable(text), size: nullable(integer), created: timestamp, retired: timestamp }),
  codeLifecycle: object({ key: codeKey, event: { enum: ['create', 'move', 'retire', 'deopt'] },
    fromAddress: nullable(text), toAddress: nullable(text), reason: nullable(text) }),
  nativeDisassembly: object({ key: codeKey, architecture: text, bytesHash: nullable(hash), listingHash: hash, range: nullable(range) }),
  wasmBytecode: object({ moduleHash: hash, functionIndex: integer, listingHash: hash, range: nullable(range) }),
  derivedClaim: object({ claim: text, scope: text, assumptions: strings, supportingEvidenceIds: strings,
    contradictingEvidenceIds: strings, method: producer, confidence: { enum: ['low', 'medium', 'high', 'unknown'] },
    confidenceBasis: strings, alternatives: strings,
    nextObservation: nullable(object({ question: text, evidenceKinds: list(kinds), expectedInformationGain: text,
      estimatedCost: text, permissionRequirements: strings })) })
};
for (const kind of ['icEvent', 'mapEvent', 'compilerFeedback', 'optimization', 'deoptimization']) {
  payloads[kind] = object({ site: nullable(text), slot: nullable(text), functionId: nullable(text),
    codeVersion: nullable(codeKey), state: nullable(text), reason: nullable(text), detailRef: nullable(rawRef) });
}
for (const kind of ['counter', 'transfer', 'wait']) {
  payloads[kind] = object({ name: text, value: nullable({ type: 'number' }), unit: nullable(text),
    fromContext: nullable(text), toContext: nullable(text), category: nullable(text) });
}
export const RUNTIME_EVIDENCE_SCHEMA = { oneOf: Object.entries(payloads).map(([kind, data]) => object({
  schemaVersion: { const: 1 }, evidenceId: text, captureId: text, projectionVersion: text,
  kind: { const: kind }, evidenceClass: { const: kind === 'derivedClaim' ? 'inferred' : 'observed' },
  scope, clock, timestamp, workload, join, rawRefs: list(rawRef), unavailable: strings, warnings: strings, data
})) };
export const RUNTIME_SCHEMAS = Object.freeze({ request: RUNTIME_REQUEST_SCHEMA, capabilities: RUNTIME_CAPABILITIES_SCHEMA,
  capture: RUNTIME_CAPTURE_MANIFEST_SCHEMA, rawArtifact: RUNTIME_RAW_ARTIFACT_SCHEMA, evidence: RUNTIME_EVIDENCE_SCHEMA });
