import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { createConfigDataAdapter } from '../../../src/index/language-registry/adapters/config-files.js';
import { createYamlImportCollector } from '../../../src/index/language-registry/import-collectors/yaml.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { postScanImports } from '../../../src/index/build/indexer/steps/relations/import-scan.js';
import { readCachedImports, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { resolveBundleImports } from '../../../src/index/build/incremental/shared.js';
import { enqueueFileRelationsArtifacts } from '../../../src/index/build/artifacts/writers/file-relations.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders/core.js';
import { getImportExtraction, summarizeImportExtraction } from '../../../src/shared/import-extraction.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { writeAndLoadRelationBenchGraphArtifacts } from '../relations/helpers/graph-relations-artifact-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await createImportResolutionTempRoot('import-extraction-handoff');
const route = getLanguageForFile('.yaml', 'failed.yaml');
const original = { collectImports: route.collectImports, collectImportEntries: route.collectImportEntries, buildRelations: route.buildRelations };
let available = false;
const calls = new Map();
const parseStructure = text => {
  calls.set(text, (calls.get(text) || 0) + 1);
  return { coverage: text === 'FAIL' && !available ? 'unavailable' : 'partial',
    reason: text === 'FAIL' && !available ? 'parser-unavailable' : null, sourceLines: 1, importEntries: [] };
};
const fixture = createConfigDataAdapter({ id: 'yaml', match: () => true, literalImports: true,
  collectImports: createYamlImportCollector({ parseStructure, parserIdentity: { id: 'fixture-parser', version: '1' } }) });
Object.assign(route, { collectImports: fixture.collectImports, collectImportEntries: fixture.collectImportEntries, buildRelations: fixture.buildRelations });
try {
  const sources = new Map([['failed.yaml', 'FAIL'], ['healthy.yaml', 'EMPTY']]);
  const files = [];
  for (const [rel, source] of sources) {
    const abs = path.join(root, rel); await fs.writeFile(abs, source);
    files.push({ abs, rel, stat: await fs.stat(abs) });
  }
  const scan = options => scanImports({ files, root, mode: 'code', languageOptions: { collectorScanBudget: { maxMs: 0 }, ...options }, importConcurrency: 1 });
  const result = await scan();
  assert.deepEqual(Object.keys(result.importsByFile), ['failed.yaml', 'healthy.yaml']);
  assert.deepEqual([...calls], [['FAIL', 1], ['EMPTY', 1]], 'the actual registry/scan path does not reparse empty arrays');
  assert.equal(result.importExtractionByFile['failed.yaml'].state, 'unavailable');
  assert.equal(result.importExtractionByFile['healthy.yaml'].recognition, 'empty');
  const state = { fileRelations: new Map(), importResolutionGraph: null };
  const post = async input => postScanImports({ mode: 'code', relationsEnabled: true,
    scanPlan: { importScanMode: 'pre', enableImportLinks: true, shouldScan: true, importGraphEnabled: true }, state,
    timing: {}, runtime: { root, toolInfo: { version: 'test' }, indexingConfig: { importResolution: {} } }, entries: files,
    importResult: input, incrementalState: null, fileTextByFile: null, hangProbeConfig: null, abortSignal: null });
  const resolved = await post(result);
  assert.equal(resolved.stats.unresolved, 0, 'no candidate specifier means no invented unresolved edge');
  assert.equal(state.importResolutionGraph.edges.length, 0);
  assert.equal(state.importResolutionGraph.nodes.length, 0, 'empty evidence does not bypass existing graph node admission');
  assert.equal(state.importResolutionGraph.extractionCoverage.states.unavailable, 1);
  assert.equal(state.importResolutionGraph.extractionCoverage.recognizedEmpty, 1);
  assert.equal(state.importResolutionGraph.extractionCoverage.reasonCounts['parser-unavailable'], 1);
  assert.equal(state.importResolutionGraph.extractionCoverage.state, 'partial', 'resolver success cannot upgrade producer coverage');
  const forgedSummary = structuredClone(state.importResolutionGraph); forgedSummary.extractionCoverage.states.unavailable++;
  assert.equal(validateArtifact('import_resolution_graph', forgedSummary).ok, false, 'coverage counts cannot contradict the file inventory');
  const failed = state.fileRelations.get('failed.yaml'), healthy = state.fileRelations.get('healthy.yaml');
  assert.equal(failed.importScanExtraction.state, 'unavailable');
  assert.equal(failed.importScanFingerprint, null);
  assert.equal(healthy.importScanFingerprint, result.importScanFingerprint);

  const bundleDir = path.join(root, 'bundles'); await fs.mkdir(bundleDir);
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
  for (const file of files) manifest.files[file.rel] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest,
    relKey: file.rel, fileStat: file.stat, fileHash: sha1(sources.get(file.rel)), fileChunks: [], bundleFormat: 'json',
    fileRelations: state.fileRelations.get(file.rel) });
  const read = (file, fingerprint = result.importScanFingerprint) => readCachedImports({ repoRoot: root, enabled: true, bundleDir, manifest,
    absPath: file.abs, relKey: file.rel, fileStat: file.stat, bundleFormat: 'json', expectedImportScanFingerprint: fingerprint });
  assert.equal(await read(files[0]), null, 'degraded empty results cannot replay as successful empty');
  const reused = await read(files[1]);
  assert.deepEqual(reused, []);
  assert.equal(getImportExtraction(reused).state, 'partial', 'the static subset keeps its original qualification');
  assert.equal(getImportExtraction(reused).recognition, 'empty');
  assert.equal(await read(files[1], 'different-parser-capability-fingerprint'), null);
  assert.equal(resolveBundleImports({ fileRelations: { imports: [], importScanFingerprint: result.importScanFingerprint } }), null,
    'historical bare empty arrays remain unqualified');
  const cachedBefore = calls.get('EMPTY');
  await scanImports({ files: [files[1]], root, mode: 'code', languageOptions: { collectorScanBudget: { maxMs: 0 } },
    importConcurrency: 1, incrementalState: { enabled: true, manifest, bundleDir, bundleFormat: 'json' } });
  assert.equal(calls.get('EMPTY'), cachedBefore, 'qualified empty cache hits retain one-parse behavior');

  const records = new Map(state.fileRelations);
  for (let i = 0; i < 40; i++) records.set(`extra-${String(i).padStart(2, '0')}.yaml`, structuredClone(healthy));
  for (const maxJsonBytes of [1024 * 1024, 16384]) {
    const outDir = path.join(root, `files-${maxJsonBytes}`); await fs.mkdir(outDir);
    const writes = [], pieces = [];
    enqueueFileRelationsArtifacts({ state: { fileRelations: records }, outDir, maxJsonBytes,
      enqueueWrite: (_label, write) => writes.push(write), formatArtifactLabel: value => value,
      addPieceFile: (entry, file) => pieces.push({ ...entry, path: path.relative(outDir, file).replaceAll('\\', '/') }) });
    for (const write of writes) await write();
    assert.ok(pieces.some(row => row.name === (maxJsonBytes === 16384 ? 'file_relations_meta' : 'file_relations')));
    await writePiecesManifest({ pieceEntries: pieces, outDir, mode: 'code',
      indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'import-extraction-handoff' } });
    const loaded = await loadJsonArrayArtifact(outDir, 'file_relations', { strict: true });
    const validation = validateArtifact('file_relations', loaded);
    assert.equal(validation.ok, true, validation.errors.join('; '));
    assert.deepEqual(summarizeImportExtraction(new Map(loaded.map(row => [row.file, row.relations]))), summarizeImportExtraction(records));
  }
  const graphDir = path.join(root, 'graph'); await fs.mkdir(graphDir);
  const { rows: graph } = await writeAndLoadRelationBenchGraphArtifacts({ outDir: graphDir, fileRelations: state.fileRelations,
    chunks: [{ file: 'healthy.yaml', chunkUid: 'healthy', name: 'healthy', kind: 'Config', codeRelations: {} }], maxJsonBytes: 16384 });
  assert.deepEqual(graph.extractionCoverage, summarizeImportExtraction(state.fileRelations), 'the actual sharded graph writer and strict loader preserve file-level failures');
  assert.equal(graph.importGraph.edgeCount, 0);

  available = true;
  const recovered = await scan(); await post(recovered);
  assert.equal(state.fileRelations.get('failed.yaml').importScanExtraction.recognition, 'empty', 'fresh capability can recover through the real producer');
  assert.equal(state.importResolutionGraph.extractionCoverage.states.unavailable || 0, 0);
  const missing = await scanImports({ files: [{ rel: 'missing.yaml', abs: path.join(root, 'missing.yaml') }], root, mode: 'code',
    languageOptions: {}, importConcurrency: 1 });
  assert.deepEqual(missing.importsByFile['missing.yaml'], []);
  assert.equal(missing.importExtractionByFile['missing.yaml'].state, 'unavailable');
  assert.equal(missing.importExtractionByFile['missing.yaml'].source.textHash, null);
  for (const error of [Object.assign(new Error('fixture programming defect'), { code: 'ERR_FIXTURE_DEFECT' }),
    Object.assign(new Error('fixture resource still owned'), { code: 'EIO', cacheOwnershipPending: true, cacheOwnershipReleased: () => false })]) {
    await assert.rejects(scanImports({ files: [files[0]], root, mode: 'code', languageOptions: {}, importConcurrency: 1,
      fileTextByFile: { get: () => null, set: () => { throw error; } } }),
    observed => error.code === 'EIO' ? observed.cacheOwnershipReleased() === false : observed === error,
    'neither programming defects nor unsettled resources become ordinary unavailable-source diagnostics');
  }
} finally { Object.assign(route, original); await fs.rm(root, { recursive: true, force: true }); }
console.log('Import extraction survives registry, zero-edge resolution, durable artifacts and qualified incremental replay.');
