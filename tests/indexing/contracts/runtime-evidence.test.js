#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertRuntimeEvidence, assertRuntimeProjection } from '../../../src/contracts/validators/runtime-evidence.js';
import { planRuntimeEvidence, assertRuntimeImportAuthority, joinRuntimeSource } from '../../../src/index/semantic/runtime/plan.js';
const hash = 'a'.repeat(64), sourceUnitId = 'su1:' + hash, generation = { baseBuildId: 'build-1', semanticRevision: 0 };
const producer = { id: 'fixture', version: '1' };
const workload = { fingerprint: hash, inputShapeHash: null, phase: 'capture', description: 'saved fixture only' };
const limits = { durationMs: 100, maxSamples: 10, maxEvents: 10, maxBytes: 4096, processTreeMemoryBytes: 10000, diskReserveBytes: 4096 };
const request = { schemaVersion: 1, requestId: 'request-1', question: 'Which code version ran?', repositoryNamespace: 'repo', generation,
  selectors: { sources: [{ sourceUnitId, byteHash: hash }], records: [], functions: [], modules: [] }, workload,
  desiredEvidence: ['cpuProfile', 'compilerFeedback', 'nativeDisassembly'], permittedCollectors: ['local-inspector', 'saved-log'], limits, expectedCoverage: ['selected process only'] };
const runtime = { executableHash: hash, nodeVersion: '26.8.1', v8Version: 'fixture', os: 'windows', architecture: 'x64', cpu: null };
const capabilities = { schemaVersion: 1, runtime, inspectorProtocolHash: null, probe: producer, evidenceRefs: ['fixture:protocol'],
  capabilities: [{ evidenceKind: 'cpuProfile', collector: 'local-inspector', status: 'supported', reason: 'recorded protocol', flags: [], methods: ['Profiler.start'] },
    { evidenceKind: 'compilerFeedback', collector: 'saved-log', status: 'unsupported', reason: 'not exposed', flags: [], methods: [] },
    { evidenceKind: 'nativeDisassembly', collector: 'saved-log', status: 'requires-restart', reason: 'flag required', flags: ['--print-opt-code'], methods: [] }] };
const plan = planRuntimeEvidence({ request, capabilities });
assert.equal(plan.action, 'plan-only'); assert.equal(plan.executionAuthorized, false);
assert.deepEqual(plan.desired.map(row => row.state), ['supported', 'unsupported', 'requires-restart']);
assert.notEqual(planRuntimeEvidence({ request, capabilities: { ...capabilities, runtime: { ...runtime, executableHash: 'b'.repeat(64) } } }).planId, plan.planId);
assert.throws(() => planRuntimeEvidence({ request: { ...request, command: 'unexpected executable action' }, capabilities }), { code: 'ERR_RUNTIME_EVIDENCE_CONTRACT' });
const raw = { schemaVersion: 1, artifactId: 'raw-1', captureId: 'capture-1', hash, byteLength: 100,
  format: 'inspector-cpu-profile', formatVersion: '1', mediaType: 'application/json', parser: producer, retained: true, pinned: true, storageRef: 'sha256:' + hash };
const scope = { sessionId: 'session-1', processId: 'process-1', isolateId: null, workerId: null };
const clock = { domain: 'inspector-1', origin: null, unit: 'us', alignment: null };
const capture = { schemaVersion: 1, captureId: 'capture-1', requestId: request.requestId, question: request.question,
  repositoryNamespace: 'repo', generation, sources: request.selectors.sources, runtime, workload, scope, clock,
  collector: producer, parser: producer, actualFlags: [], instrumentation: { sampling: 'cpu', preciseCoverage: false,
    debugger: false, pauses: false, tracing: [], perturbation: ['sampling overhead unknown'] }, startedAt: null, endedAt: null,
  limits, completion: 'partial', coverage: ['process-1 only'], warnings: ['worker not captured'], droppedEvents: null, rawArtifacts: [raw] };
assert.equal(assertRuntimeImportAuthority({ authority: { action: 'import-existing', captureId: capture.captureId, artifactHashes: [hash] }, capture, artifacts: [raw] }).executionAuthorized, false);
assert.throws(() => assertRuntimeImportAuthority({ authority: { action: 'execute', captureId: capture.captureId, artifactHashes: [hash] }, capture, artifacts: [raw] }), { code: 'ERR_RUNTIME_IMPORT_AUTHORITY' });
const evidence = { schemaVersion: 1, evidenceId: 'observation-1', captureId: capture.captureId, projectionVersion: '1', kind: 'codeVersion',
  evidenceClass: 'observed', scope, clock, timestamp: null, workload,
  join: { quality: 'unresolved', sourceUnitId: null, sourceHash: null, targets: [], reasons: ['source map missing'], sourceMapHash: null },
  rawRefs: [{ artifactId: raw.artifactId, hash, byteRange: null }], unavailable: ['tier'], warnings: [],
  data: { key: { sessionId: scope.sessionId, processId: scope.processId, codeId: '0x100', lifetimeId: 'creation-1' },
    functionId: null, moduleHash: null, tier: null, architecture: 'x64', codeHash: null, disassemblyHash: null,
    address: '0x100', size: null, created: null, retired: null } };
assertRuntimeEvidence('evidence', evidence);
const second = structuredClone(evidence); second.data.key.lifetimeId = 'creation-2'; second.data.tier = 'reported-tier';
assertRuntimeEvidence('evidence', second); assert.notDeepEqual(second.data.key, evidence.data.key);
assert.throws(() => assertRuntimeEvidence('evidence', { ...evidence, evidenceClass: 'inferred' }), { code: 'ERR_RUNTIME_EVIDENCE_CONTRACT' });
const wrongScope = structuredClone(evidence); wrongScope.data.key.sessionId = 'other-session';
assert.throws(() => assertRuntimeEvidence('evidence', wrongScope), { code: 'ERR_RUNTIME_EVIDENCE_CONTRACT' });
const claim = { ...evidence, evidenceId: 'claim-1', kind: 'derivedClaim', evidenceClass: 'inferred', rawRefs: [],
  data: { claim: 'Candidate specialization', scope: 'one workload', assumptions: ['mapping is partial'], supportingEvidenceIds: ['observation-1'], contradictingEvidenceIds: [],
    method: producer, confidence: 'low', confidenceBasis: ['partial mapped evidence'], alternatives: ['another code version'],
    nextObservation: { question: 'Which tier?', evidenceKinds: ['codeVersion'], expectedInformationGain: 'resolve tier', estimatedCost: 'bounded code log', permissionRequirements: ['explicit capture authorization'] } } };
assertRuntimeEvidence('evidence', claim);
assert.equal(assertRuntimeProjection({ capture, evidence: [evidence, claim] }).recordCount, 2);
assert.throws(() => assertRuntimeProjection({ capture, evidence: [{ ...evidence, workload: { ...workload, phase: 'warmup' } }] }), { code: 'ERR_RUNTIME_EVIDENCE_JOIN' });
assert.throws(() => assertRuntimeProjection({ capture, evidence: [claim] }), { code: 'ERR_RUNTIME_EVIDENCE_JOIN' });
assert.equal(joinRuntimeSource({ sourceHash: hash, candidates: [{ sourceHash: 'b'.repeat(64), sourceUnitId, targets: [] }] }).quality, 'unresolved');
assert.equal(joinRuntimeSource({ sourceHash: hash, candidates: [{ sourceHash: hash, sourceUnitId, targets: [] }] }).quality, 'exact-source');
assert.equal(joinRuntimeSource({ sourceHash: hash, candidates: [{ sourceHash: hash, sourceUnitId, targets: [] },
  { sourceHash: hash, sourceUnitId: 'su1:' + 'b'.repeat(64), targets: [] }] }).quality, 'ambiguous');
console.log('runtime planning, offline import authority, scoped code lifetimes and explicit uncertainty passed');
