import { runNode as runNodeFixture } from '../../helpers/run-node.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPublishedSemanticWitness } from '../../helpers/published-semantic-witness.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { queryRuntimeEvidence, defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';

import { fileURLToPath } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { qualifyRuntimeSourceCandidates, runtimeObservationTargets } from '../../../src/index/semantic/runtime/source-authority.js';
import { createRuntimeObservation } from '../../../src/index/semantic/runtime/adapters/shared.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('storage/semantic/runtime-source-reference-authority/')[1];
assert.ok(['source-authority', 'cli-generation-pin', 'projection-order-forward', 'projection-order-reverse'].includes(selected));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-reference-'));
let fixture;
try {
  // Runtime coordinate ownership needs two authored functions plus one foreign
  // source. Buffer/worker flow workloads belong to their dedicated consumers.
  const witness = await createPublishedSemanticWitness({ root: path.join(root, 'source'), threads: 1,
    sourceFiles: {
      'snapshot.ts': 'export function build(seed:number) { return seed + 1; }\nexport function render(payload:number[]) { return payload.length; }\n',
      'host.ts': 'export function foreign() { return 0; }\n'
    } });
  const source = [...witness.sources.values()].find(row => row.path === 'snapshot.ts');
  const functions = witness.records.filter(row => row.kind === 'scope' && row.data.scopeKind === 'FunctionDeclaration'
    && row.sourceUnitId === source.sourceUnitId).sort((a, b) => a.span[0] - b.span[0]);
  assert.equal(functions.length, 2, 'real published source has two distinct function scopes');
  const host = witness.records.find(row => row.sourceUnitId !== source.sourceUnitId);
  fixture = await createRuntimeImportFixture();
  const options = fixture.options();
  options.capture = { ...options.capture, repositoryNamespace: source.repositoryNamespace,
    generation: witness.manifest.generation, sources: [...witness.sources.values()].map(row => ({ sourceUnitId: row.sourceUnitId, byteHash: row.byteHash })),
    warnings: ['saved synthetic fixture; numeric samples are not live performance evidence'],
    workload: { ...options.capture.workload, description: 'Saved synthetic source-coordinate fixture; no live capture or performance measurement' } };
  options.semanticContext = witness.semanticContext;
  options.sourceCandidates = [{ sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, targets: functions.map(row => row.ref) }];
  const qualified = await qualifyRuntimeSourceCandidates({ capture: options.capture, candidates: options.sourceCandidates,
    semanticContext: witness.semanticContext });
  const overlap = witness.records.find(row => row.sourceUnitId === source.sourceUnitId && row.kind === 'statement'
    && row.data.astKind === 'FunctionDeclaration' && row.span[0] === functions[0].span[0] && row.span[1] === functions[0].span[1]);
  assert.ok(overlap, 'published function has a distinct overlapping function statement record');
  const overlapping = await qualifyRuntimeSourceCandidates({ capture: options.capture,
    candidates: [{ ...options.sourceCandidates[0], targets: [functions[0].ref, overlap.ref] }], semanticContext: witness.semanticContext });
  let startLine = source.lineStarts.length - 1;
  while (source.lineStarts[startLine] > functions[0].span[0]) startLine--;
  const functionPosition = { lineNumber: startLine, columnNumber: functions[0].span[0] - source.lineStarts[startLine] };
  const overlappingResult = runtimeObservationTargets({ candidates: overlapping, kind: 'cpuProfile', data: functionPosition });
  assert.equal(overlappingResult.targetQuality, 'ambiguous'); assert.deepEqual(overlappingResult.targets, []);
  const duplicate = await qualifyRuntimeSourceCandidates({ capture: options.capture,
    candidates: [{ ...options.sourceCandidates[0], targets: [functions[0].ref, functions[0].ref] }], semanticContext: witness.semanticContext });
  assert.deepEqual(runtimeObservationTargets({ candidates: duplicate, kind: 'cpuProfile', data: functionPosition }).targets, [functions[0].ref]);
  const ambiguous = runtimeObservationTargets({ candidates: qualified, kind: 'cpuProfile',
    data: { lineNumber: 0, columnNumber: 0, inlineFrames: [{ functionName: 'inlined' }] } });
  assert.equal(ambiguous.targetQuality, 'ambiguous'); assert.deepEqual(ambiguous.targets, []);
  const unknownMap = runtimeObservationTargets({ candidates: qualified.map(candidate => ({ ...candidate,
    source: { ...candidate.source, mapping: { identity: 'unknown-map' } } })), kind: 'cpuProfile', data: { lineNumber: 0, columnNumber: 0 } });
  assert.deepEqual(unknownMap.targets, [], 'unqualified coordinate mappings cannot broadcast source references');
  const log = (await fs.readFile(fixture.inputs[1].path, 'utf8')).trim().split('\n').map(JSON.parse);
  for (const row of log.slice(1)) {
    row.sourceHash = source.byteHash;
    if (row.kind === 'scriptMetadata') row.data.contentHash = source.byteHash;
  }
  const profile = { nodes: functions.map((row, index) => {
    let line = source.lineStarts.length - 1;
    while (source.lineStarts[line] > row.span[0]) line--;
    return { id: index + 1, callFrame: { functionName: index ? 'render' : 'build', scriptId: '42', url: 'snapshot.ts',
      lineNumber: line, columnNumber: row.span[0] - source.lineStarts[line] } };
  }), startTime: 0, endTime: 20, samples: [1, 2], timeDeltas: [10, 10] };
  const add = async (name, bytes, format) => fixture.addRaw({ name, bytes: Buffer.from(bytes), format });
  const logArtifact = await add('witness-log.jsonl', log.map(row => JSON.stringify(row)).join('\n') + '\n', 'pairofcleats-code-log');
  const profileArtifact = await add('witness.cpuprofile', JSON.stringify(profile), 'inspector-cpu-profile');
  options.capture.rawArtifacts = [logArtifact, profileArtifact];
  options.inputs = fixture.inputs.slice(-2);
  options.authority = { ...options.authority, artifactHashes: options.capture.rawArtifacts.map(row => row.hash) };
  const imported = await importRuntimeEvidence(options);
  const importedRows = await fixture.readRows(imported);
  assert.ok(importedRows.every(row => row.warnings.includes(options.capture.warnings[0])),
    'saved synthetic qualification survives standalone observation hydration/export');
  const warningInput = { capture: options.capture, artifact: profileArtifact, kind: 'cpuProfile',
    data: importedRows.find(row => row.kind === 'cpuProfile').data, sourceCandidates: qualified,
    sourceHash: source.byteHash, identity: 'warning-projection' };
  const warnings = createRuntimeObservation({ ...warningInput, warnings: [options.capture.warnings[0], 'adapter-specific caution'] }).warnings;
  assert.deepEqual(warnings, [options.capture.warnings[0], 'adapter-specific caution']);
  const boundedWarnings = createRuntimeObservation({ ...warningInput, capture: { ...options.capture,
    warnings: [...options.capture.warnings, 'oversize caution '.repeat(2048), ...Array.from({ length: 96 }, (_, id) => 'caution ' + id)] } }).warnings;
  assert.ok(boundedWarnings.includes(options.capture.warnings[0]));
  assert.ok(boundedWarnings.includes('runtime_warning_projection_truncated'));
  assert.ok(boundedWarnings.length <= 64 && Buffer.byteLength(JSON.stringify(boundedWarnings)) <= 8192);
  const overlappingImport = await importRuntimeEvidence({ ...options,
    sourceCandidates: [{ ...options.sourceCandidates[0], targets: [functions[0].ref, overlap.ref] }] });
  const overlappingRows = await fixture.readRows(overlappingImport);
  const firstFunctionCpu = overlappingRows.find(row => row.kind === 'cpuProfile' && row.data.functionName === 'build');
  assert.equal(firstFunctionCpu.join.targetQuality, 'ambiguous'); assert.deepEqual(firstFunctionCpu.join.targets, []);
  const unverified = await importRuntimeEvidence({ ...options, semanticContext: null });
  assert.ok((await fixture.readRows(unverified)).every(row => row.join.targets.length === 0));
  const variants = [imported, overlappingImport, unverified].map(result => result.pointer.generationId);
  const expectedQualities = new Map([[variants[0], 'verified-coordinate'], [variants[1], 'ambiguous'], [variants[2], 'unverified-candidate']]);
  if (selected === 'cli-generation-pin') {
    const specification = path.join(root, 'runtime-specification.json');
    await fs.writeFile(specification, JSON.stringify({ capture: options.capture, authority: options.authority,
      inputs: options.inputs, sourceCandidates: options.sourceCandidates, importOptions: options.importOptions }));
    const cli = fileURLToPath(new URL('../../../tools/ingest/runtime-evidence.js', import.meta.url));
    const cliEnvironment = applyTestEnv({ cacheRoot: witness.cacheRoot, syncProcess: false });
    const execute = args => runNodeFixture([cli, '--specification', specification,
      '--out', path.join(root, 'cli-import'), ...args], 'Node process fixture', process.cwd(), process.env, { stdio: 'pipe', encoding: 'buffer', allowFailure: true, spawnOptions: { env: cliEnvironment, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 } });
    const pinned = execute(['--repo', witness.repoRoot, '--generation', JSON.stringify(witness.manifest.generation)]);
    assert.equal(pinned.error, undefined, 'bounded CLI completes and reaps its child');
    assert.equal(pinned.status, 0, pinned.stderr);
    const pinnedResult = JSON.parse(pinned.stdout.trim().split('\n').at(-1));
    assert.equal(pinnedResult.semanticVerification, 'pinned-generation');
    assert.ok(pinnedResult.recordCount > 0);
    for (const args of [['--repo', witness.repoRoot], ['--generation', JSON.stringify(witness.manifest.generation)]]) {
      const incomplete = execute(args);
      assert.equal(incomplete.error, undefined);
      assert.notEqual(incomplete.status, 0);
      assert.match(incomplete.stderr, /must be supplied together/);
    }
    const stale = execute(['--repo', witness.repoRoot, '--generation', JSON.stringify({ baseBuildId: 'stale', semanticRevision: 0 })]);
    assert.equal(stale.error, undefined);
    assert.notEqual(stale.status, 0, 'stale generation must not silently fall back to current');
  }
  const request = { schemaVersion: 1, repositoryNamespace: source.repositoryNamespace, generation: witness.manifest.generation,
    familyGenerations: [imported.pointer.generationId], selectors: defaultRuntimeQuerySelectors(),
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, cursor: null };
  const query = async refs => queryRuntimeEvidence({ destination: options.destination,
    request: { ...request, selectors: { ...request.selectors, records: refs } } });
  if (selected === 'source-authority') {
    for (const [index, fn] of functions.entries()) {
      const result = await query([fn.ref]);
      assert.equal(result.observations.length, 1);
      assert.equal(result.observations[0].data.functionName, index ? 'render' : 'build');
      assert.equal(result.observations[0].join.targetQuality, 'verified-coordinate');
      assert.deepEqual(result.observations[0].join.targets, [fn.ref]);
    }
    for (const targets of [
      [{ partitionId: 'sy1:' + 'f'.repeat(64), localId: 987654321 }],
      [{ ...functions[0].ref, localId: 987654321 }], [host.ref]
    ]) {
      const invalid = await importRuntimeEvidence({ ...options, sourceCandidates: [{ ...options.sourceCandidates[0], targets }] });
      const rows = await fixture.readRows(invalid);
      assert.ok(rows.every(row => row.join.targets.length === 0), 'invalid or foreign-source references retain file evidence without record authority');
    }
  }
  if (selected.startsWith('projection-order-')) {
    const familyGenerations = selected === 'projection-order-forward' ? variants : [...variants].reverse();
    const logicalIds = new Set(), owners = new Set();
    let cursor = null;
    do {
      const page = await queryRuntimeEvidence({ destination: options.destination, request: { ...request,
        familyGenerations, selectors: { ...request.selectors, kinds: ['cpuProfile'] },
        limits: { ...request.limits, maxRecords: 1 }, cursor } });
      cursor = page.nextCursor;
      for (const row of page.observations.filter(row => row.data.functionName === 'build')) {
        const owner = page.pinnedFamilies[row.reference.family];
        logicalIds.add(row.evidenceId); owners.add(owner.generationId);
        assert.equal(row.join.targetQuality, expectedQualities.get(owner.generationId));
        assert.deepEqual(row.join.targets, owner.generationId === variants[0] ? [functions[0].ref] : []);
        assert.equal(page.explanations[0].evidenceRefs[0].rowHash, row.reference.rowHash);
        assert.equal(page.explanations[0].evidenceRefs[0].family, row.reference.family);
      }
    } while (cursor);
    assert.equal(logicalIds.size, 1, 'the same observation keeps its logical ID across attribution variants');
    assert.deepEqual(owners, new Set(variants), 'no weaker projection overwrites or disappears behind a sibling');
  }
  if (selected === 'source-authority') {
    await assert.rejects(importRuntimeEvidence({ ...options, semanticContext: { ...witness.semanticContext,
      manifest: { ...witness.manifest, generation: { baseBuildId: 'stale', semanticRevision: 0 } } } }), { code: 'ERR_RUNTIME_QUERY_SCOPE' });
    const outOfRange = structuredClone(profile); outOfRange.nodes.forEach(row => { row.callFrame.columnNumber = source.textLength + 1; });
    const outside = await add('outside.cpuprofile', JSON.stringify(outOfRange), 'inspector-cpu-profile');
    const outsideImport = await importRuntimeEvidence({ ...options, capture: { ...options.capture, rawArtifacts: [logArtifact, outside] },
      inputs: [options.inputs[0], fixture.inputs.at(-1)], authority: { ...options.authority, artifactHashes: [logArtifact.hash, outside.hash] } });
    assert.ok((await fixture.readRows(outsideImport)).every(row => row.join.targets.length === 0));
  }
  console.log(`Published semantic generations qualify ${selected} with the same capture's verified/ambiguous/unavailable projections retained together.`);
} finally { await fixture?.cleanup(); await fs.rm(root, { recursive: true, force: true }); }
