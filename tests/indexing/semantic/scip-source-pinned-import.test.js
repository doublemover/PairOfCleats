import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { prepareScipSemanticImport, loadScipSemanticSources, writeScipSemanticImport, SCIP_SEMANTIC_IMPORT_VERSION } from '../../../src/index/tooling/scip-semantic-import.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';

const f = await createRecoveryFixture('😀 value value');
try {
  const syntax = await f.write([
    { family: 'node', row: { id: 0, kind: 'declaration', span: [3, 8], scope: null,
      data: { nameId: 0, declarationKind: 'fixture-function', flags: [], initializer: null, typeSyntax: null } } },
    { family: 'node', row: { id: 1, kind: 'occurrence', span: [9, 14], scope: null,
      data: { nameId: 0, roles: ['reference'], expression: null, flags: [] } } },
    { family: 'lookup', row: { kind: 'name', id: 0, value: 'value' } }
  ]);
  const facts = createSemanticFactsRef({ source: f.source, syntaxPartitionId: syntax.partitionId, partitions: [syntax],
    storage: { generation: f.generation, relativePath: 'semantic' }, coverage: [] });
  const state = { semanticFactsByFile: new Map([['original.js', facts]]), semanticCompilerContexts: [],
    semanticDiskAccount: f.account, semanticEvidenceArtifacts: [] };
  const runtime = { root: f.root, buildRoot: f.root };
  const admittedSources = await loadScipSemanticSources({ state, runtime });
  await assert.rejects(loadScipSemanticSources({ state: { ...state,
    semanticFactsByFile: new Map([['original.js', { ...facts, sourceHash: '0'.repeat(64) }]]) }, runtime }),
  { code: 'ERR_SCIP_IMPORT_IDENTITY' }, 'retained byte identity must still join the current parser facts');
  const index = { metadata: { projectRoot: 'file:///producing-root/', toolInfo: { name: 'scip-fixture', version: '1' } },
    documents: [{ relativePath: 'original.js', positionEncoding: 2, symbols: [{ symbol: 'scip npm fixture 1 value().', relationships: [] }],
      occurrences: [{ symbol: 'scip npm fixture 1 value().', symbolRoles: 1, range: [0, 3, 8] },
        { symbol: 'scip npm fixture 1 value().', symbolRoles: 0, range: [0, 9, 14] }] }] };
  const receiptFor = value => ({ schemaVersion: 1, artifactHash: createHash('sha256').update(Buffer.from(JSON.stringify(value))).digest('hex'),
    profileHash: 'a'.repeat(64), repositoryNamespace: f.source.repositoryNamespace, generation: f.generation,
    projectVariant: 'debug', producerRoot: index.metadata.projectRoot, sources: [{ documentPath: 'original.js', sourceUnitId: f.source.sourceUnitId,
      byteHash: f.source.byteHash, syntaxPartitionId: syntax.partitionId, syntaxHash: syntax.canonicalHash, mappingIdentity: null }] });
  const prepare = (value, receipt = receiptFor(value)) => prepareScipSemanticImport({ bytes: Buffer.from(JSON.stringify(value)),
    producingReceipt: receipt, expectedReceiptHash: semanticHash('tooling.scip-producing-receipt.v1', receipt),
    generation: f.generation, repositoryNamespace: f.source.repositoryNamespace, projectVariant: 'debug', producerRoot: index.metadata.projectRoot, admittedSources });
  for (const [positionEncoding, definition, reference] of [[1, [0, 5, 10], [0, 11, 16]], [2, [0, 3, 8], [0, 9, 14]], [3, [0, 2, 7], [0, 8, 13]]]) {
    const variant = structuredClone(index); variant.documents[0].positionEncoding = positionEncoding;
    variant.documents[0].occurrences[0].range = definition; variant.documents[0].occurrences[1].range = reference;
    assert.deepEqual(prepare(variant).documents[0].occurrences[0].span, [3, 8]);
    for (const spelling of ['camel', 'snake']) for (const multiline of [false, true]) {
      const typed = structuredClone(variant);
      for (const occurrence of typed.documents[0].occurrences) {
        const [line, start, end] = occurrence.range; delete occurrence.range;
        if (spelling === 'camel') occurrence[multiline ? 'multiLineRange' : 'singleLineRange'] = multiline
          ? { startLine: line, startCharacter: start, endLine: line, endCharacter: end }
          : { startCharacter: start, endCharacter: end }; // omitted proto3 line defaults to zero
        else occurrence[multiline ? 'multi_line_range' : 'single_line_range'] = multiline
          ? { start_line: line, start_character: start, end_line: line, end_character: end }
          : { start_character: start, end_character: end };
      }
      assert.deepEqual(prepare(typed).documents[0].occurrences.map(value => value.span), [[3, 8], [9, 14]],
        'typed ' + spelling + '/' + (multiline ? 'multi-line' : 'single-line') + ' respects document position units');
      for (let index = 0; index < typed.documents[0].occurrences.length; index++) {
        typed.documents[0].occurrences[index].range = variant.documents[0].occurrences[index].range;
      }
      assert.equal(prepare(typed).status, 'admitted', 'equivalent typed/deprecated coordinates agree');
    }
  }
  const prepared = prepare(index);
  assert.deepEqual(prepared.adapterIdentity, { version: SCIP_SEMANTIC_IMPORT_VERSION, sourceCoordinates: SEMANTIC_ANALYSIS_VERSIONS.lspBindings });
  const mutableVariant = { name: 'debug', settings: { target: 'fixture' } }, mutableGeneration = { ...f.generation };
  const mutableIndex = structuredClone(index);
  for (const occurrence of mutableIndex.documents[0].occurrences) {
    occurrence.singleLineRange = { line: 0, startCharacter: occurrence.range[1], endCharacter: occurrence.range[2] };
    delete occurrence.range;
  }
  const mutableReceipt = receiptFor(mutableIndex); mutableReceipt.projectVariant = mutableVariant;
  mutableReceipt.generation = { ...mutableGeneration };
  const mutableBytes = Buffer.from(JSON.stringify(mutableIndex));
  const expectedReceiptHash = semanticHash('tooling.scip-producing-receipt.v1', mutableReceipt);
  let inspected = false;
  const pinned = prepareScipSemanticImport({ bytes: mutableBytes, producingReceipt: mutableReceipt, expectedReceiptHash,
    generation: mutableGeneration, projectVariant: mutableVariant, repositoryNamespace: f.source.repositoryNamespace,
    producerRoot: index.metadata.projectRoot, admittedSources, signal: { get aborted() {
      if (!inspected) {
        inspected = true; mutableGeneration.semanticRevision++; mutableVariant.settings.target = 'caller-replaced';
        mutableReceipt.sources[0].byteHash = '0'.repeat(64); mutableBytes.fill(0);
      }
      return false;
    } } });
  assert.ok(inspected); assert.equal(pinned.status, 'admitted');
  assert.deepEqual(pinned.generation, f.generation);
  assert.deepEqual(pinned.projectVariant, { name: 'debug', settings: { target: 'fixture' } });
  mutableGeneration.baseBuildId = 'changed-after-return'; mutableVariant.name = 'changed-after-return';
  assert.deepEqual(pinned.generation, f.generation);
  assert.equal(pinned.projectVariant.name, 'debug');
  assert.equal(pinned.artifactHash, createHash('sha256').update(Buffer.from(JSON.stringify(mutableIndex))).digest('hex'));
  assert.equal(pinned.documents[0].original.relativePath, 'original.js');
  const splitScalar = structuredClone(index);
  splitScalar.documents[0].occurrences.push({ symbol: 'scip npm fixture 1 value().', symbolRoles: 0, range: [0, 0, 1] });
  assert.equal(prepare(splitScalar).rejected, 1, 'UTF16 roundtrip alone cannot admit half of the leading emoji');
  const oldMeaning = { ...prepared, adapterIdentity: { ...prepared.adapterIdentity, sourceCoordinates: 'old-coordinate-meaning' } };
  await assert.rejects(writeScipSemanticImport({ prepared: oldMeaning }), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  const legacyMeaning = { ...prepared }; delete legacyMeaning.adapterIdentity;
  await assert.rejects(writeScipSemanticImport({ prepared: legacyMeaning }), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  await assert.rejects(writeScipSemanticImport({ prepared: { ...prepared, adapterIdentity: { ...prepared.adapterIdentity, version: '2' } } }),
    { code: 'ERR_SCIP_IMPORT_IDENTITY' }, 'old receipt ownership meaning cannot be published');
  await assert.rejects(writeScipSemanticImport({ prepared: { ...prepared, adapterIdentity: { ...prepared.adapterIdentity, version: '3' } } }),
    { code: 'ERR_SCIP_IMPORT_IDENTITY' }, 'old role/range admission meaning cannot be published');
  await assert.rejects(writeScipSemanticImport({ prepared: { ...prepared, adapterIdentity: { ...prepared.adapterIdentity, version: '4' } } }),
    { code: 'ERR_SCIP_IMPORT_IDENTITY' }, 'old containing-declaration join meaning cannot be published');
  const result = await writeScipSemanticImport({ prepared: pinned, state, policy: normalizeSemanticConfig({ enabled: true }),
    semanticSink: createSemanticProviderResultSink({ state, runtime }) });
  assert.equal(result.persisted, 1);
  assert.equal(result.output.contexts[0].providerVersion, SCIP_SEMANTIC_IMPORT_VERSION);
  const store = f.store(state.semanticFactsByFile.get('original.js').partitions), records = [];
  for await (const row of store.iterateRows(result.output.partitions[0].partitionId, 'semantic_records')) records.push(row);
  const binding = records.find(row => row.kind === 'binding');
  assert.equal(binding.data.status, 'resolved');
  assert.ok(records.filter(row => row.kind === 'evidence').every(row => row.data.producerVersion === SCIP_SEMANTIC_IMPORT_VERSION));
  const detail = await createSemanticDetailService()({ store, request: { repoRoot: f.root, generation: f.generation,
    refs: [{ partitionId: result.output.partitions[0].partitionId, localId: binding.id }] } });
  assert.equal(detail.records[0].data.candidateCount, 1);
  for (const invalidRole of [2 ** 31, 2 ** 32, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER, -1, 1.5]) {
    const invalid = structuredClone(index); invalid.documents[0].occurrences[0].symbolRoles = invalidRole;
    const rejected = prepare(invalid);
    assert.equal(rejected.status, 'partial'); assert.equal(rejected.rejected, 1);
    assert.equal(rejected.definitions.size, 0, 'out-of-int32 role cannot truncate into a definition bit');
  }
  const wrappedDefinition = structuredClone(index); wrappedDefinition.documents[0].occurrences[0].symbolRoles = 2 ** 32 + 1;
  const rejectedPrepared = prepare(wrappedDefinition);
  const rejectedWritten = await writeScipSemanticImport({ prepared: rejectedPrepared, state,
    policy: normalizeSemanticConfig({ enabled: true }) });
  const rejectedStore = f.store([syntax, ...rejectedWritten.output.partitions]), rejectedRecords = [];
  for await (const row of rejectedStore.iterateRows(rejectedWritten.output.partitions[0].partitionId, 'semantic_records')) rejectedRecords.push(row);
  const unresolved = rejectedRecords.find(row => row.kind === 'binding');
  assert.equal(unresolved.data.status, 'heuristic', 'a rejected wrapped definition cannot become an exact persisted target');
  const unresolvedDetail = await createSemanticDetailService()({ store: rejectedStore, request: { repoRoot: f.root,
    generation: f.generation, refs: [{ partitionId: rejectedWritten.output.partitions[0].partitionId, localId: unresolved.id }] } });
  assert.equal(unresolvedDetail.records[0].data.status, 'heuristic');
  assert.equal(rejectedPrepared.documents[0].original.occurrences[0].symbolRoles, 2 ** 32 + 1,
    'original invalid role metadata stays in retained document evidence');
  const unsupportedRole = structuredClone(index); unsupportedRole.documents[0].occurrences[0].symbolRoles = 129;
  assert.equal(prepare(unsupportedRole).omitted, 1, 'unknown in-range role bits remain counted and original metadata is retained');
  const conflict = structuredClone(index);
  conflict.documents[0].occurrences[0].singleLineRange = { line: 0, startCharacter: 4, endCharacter: 8 };
  assert.throws(() => prepare(conflict), /typed\/deprecated occurrence range/);
  const oneof = structuredClone(mutableIndex);
  oneof.documents[0].occurrences[0].multi_line_range = { start_line: 0, start_character: 3, end_line: 0, end_character: 8 };
  assert.throws(() => prepare(oneof), /typed occurrence range alternatives/);
  const malformedTyped = structuredClone(index);
  malformedTyped.documents[0].occurrences[0].singleLineRange = { endCharacter: 'not-an-int32' };
  assert.equal(prepare(malformedTyped).rejected, 1, 'malformed typed presence never falls back to valid legacy coordinates');
  const typedSplit = structuredClone(mutableIndex);
  typedSplit.documents[0].occurrences[0].singleLineRange = { startCharacter: 0, endCharacter: 1 };
  assert.equal(prepare(typedSplit).rejected, 1, 'typed UTF16 range cannot split a source scalar');
  const defaultLegacy = structuredClone(mutableIndex); defaultLegacy.documents[0].occurrences[0].range = [];
  assert.equal(prepare(defaultLegacy).status, 'admitted', 'empty deprecated repeated field does not override a valid typed range');
  const stale = receiptFor(index); stale.sources[0].byteHash = '0'.repeat(64);
  assert.throws(() => prepare(index, stale), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  const escape = structuredClone(index); escape.documents[0].relativePath = '../escape.js';
  assert.throws(() => prepare(escape), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  const ambiguous = structuredClone(index); ambiguous.documents[0].positionEncoding = 0;
  assert.throws(() => prepare(ambiguous), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  const unknown = prepareScipSemanticImport({ bytes: Buffer.from(JSON.stringify(index)), producingReceipt: null });
  assert.equal(unknown.status, 'non-authoritative');
  assert.equal((await writeScipSemanticImport({ prepared: unknown })).persisted, 0);
  const boundedOptions = { bytes: Buffer.from(JSON.stringify(index)), producingReceipt: { extra: '\u0000'.repeat(180000) },
    expectedReceiptHash: 'a'.repeat(64), generation: f.generation, projectVariant: 'debug',
    repositoryNamespace: f.source.repositoryNamespace, producerRoot: index.metadata.projectRoot, admittedSources };
  assert.throws(() => prepareScipSemanticImport(boundedOptions), error => error.code === 'ERR_SCIP_IMPORT_IDENTITY'
    && /receipt\/context byte budget/.test(error.message));
  const largerReceipt = receiptFor(index); largerReceipt.extra = 'x'.repeat(1024 * 1024);
  const largerOptions = { ...boundedOptions, producingReceipt: largerReceipt,
    expectedReceiptHash: semanticHash('tooling.scip-producing-receipt.v1', largerReceipt) };
  assert.throws(() => prepareScipSemanticImport(largerOptions), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  assert.equal(prepareScipSemanticImport({ ...largerOptions, maxBytes: 2 * 1024 * 1024 }).status, 'admitted',
    'the existing explicitly selected SCIP allowance remains available instead of imposing the report adapters ceiling');
  let getters = 0;
  assert.throws(() => prepareScipSemanticImport({ ...boundedOptions, producingReceipt: { get sources() { getters++; return []; } } }), /getters/);
  assert.equal(getters, 0);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => prepareScipSemanticImport({ ...boundedOptions, producingReceipt: receiptFor(index), signal: controller.signal }), { name: 'AbortError' });
  console.log('SCIP source receipt, exact UTF-8/16/32 ranges, canonical sink and binding detail');
} finally { await f.cleanup(); }
