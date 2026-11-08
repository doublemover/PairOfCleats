import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { writeIncrementalBundle, readCachedImports } from '../../../src/index/build/incremental.js';
import { readBundleFile } from '../../../src/shared/bundle-io.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createImportExtraction,importExtractionRuntimeVersions } from '../../../src/shared/import-extraction.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

/** Real source scan and durable import bundle; lexical partial receipts must
 * refresh, never gain parser authority merely because their values are right. */
export const assertEscapedImportReplay = async ({ name, file, source, expected, onPhase = null, onRoot = null, collectorNow = () => 0 }) => {
  const { dir: root } = await prepareIsolatedTestCacheDir(name);
  onRoot?.(root);
  const timed = async (phase, operation) => {
    if (!onPhase) return operation();
    const started = performance.now(), cpu = process.cpuUsage(), before = process.memoryUsage();
    const result = await operation();
    onPhase({ phase, wallMs: performance.now() - started, cpu: process.cpuUsage(cpu), before, after: process.memoryUsage() });
    return result;
  };
  const abs = path.join(root,file); await fs.mkdir(path.dirname(abs),{recursive:true}); await fs.writeFile(abs,source);
  const stat = await fs.stat(abs), bundleDir = path.join(root,'bundles'); await fs.mkdir(bundleDir);
  const manifest = { artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,bundleFormat:'json',files:{} };
  const run = incrementalState => timed(incrementalState ? 'incremental-refresh-scan' : 'cold-source-scan', () => scanImports({root,files:[{abs,rel:file,stat}],mode:'code',importConcurrency:1,
    languageOptions:{treeSitter:{enabled:false},pythonAst:{enabled:false},...(typeof collectorNow === 'function' ? { collectorNow } : {})},incrementalState}));
  const cold = await run(); assert.deepEqual(cold.importsByFile[file],expected.toSorted());
  const fingerprint = producer => sha1(stableStringifyForSignature({ producer,
    extractionRuntime:importExtractionRuntimeVersions(),node:process.versions.node,mode:'code',languageOptions:{} }));
  assert.equal(cold.importScanFingerprint,fingerprint(SEMANTIC_ANALYSIS_VERSIONS.importResolution));
  const write = async (identity, imports = expected, extraction = cold.importExtractionByFile[file]) => {
    const entry = await timed('durable-import-bundle-publication', () => writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: file, fileStat: stat,
      fileHash: sha1(source), fileChunks: [], bundleFormat: 'json', fileRelations: { imports, importScanFingerprint: identity, importScanExtraction: extraction } }));
    assert.ok(entry && Array.isArray(entry.bundles) && entry.bundles.length > 0, 'actual durable import bundle publication must succeed');
    assert.equal(entry.bundleInventory.length, entry.bundles.length);
    for (const name of entry.bundles) {
      assert.equal(path.basename(name), name);
      const admitted = await readBundleFile(path.join(bundleDir, name), { format: 'json', repoRoot: root });
      assert.equal(admitted.ok, true); assert.equal(admitted.bundle.fileRelations.importScanFingerprint, identity);
      assert.deepEqual(admitted.bundle.fileRelations.imports, imports);
    }
    return entry;
  };
  manifest.files[file] = await write(cold.importScanFingerprint);
  const read = fingerprint => timed('original-replay-admission', () => readCachedImports({enabled:true,absPath:abs,relKey:file,fileStat:stat,manifest,bundleDir,
    bundleFormat:'json',expectedImportScanFingerprint:fingerprint}));
  assert.equal(await read(cold.importScanFingerprint),null,'partial lexical scans retain refresh-required policy');
  assert.deepEqual((await run({enabled:true,manifest,bundleDir,bundleFormat:'json'})).importsByFile[file],expected.toSorted());
  const obsolete=['phantom-from-retired-producer'];
  const previousProducer=String(Number(SEMANTIC_ANALYSIS_VERSIONS.importResolution)-1);
  manifest.files[file] = await write(fingerprint(previousProducer),obsolete,createImportExtraction({entries:obsolete,text:source,
    producerId:'historical-qualified-fixture',parser:{id:'historical-parser',version:'1',available:true},
    parserCoverage:'complete',scope:'historical-producer-output'}));
  assert.deepEqual(Array.from(await read(fingerprint(previousProducer))), obsolete,
    'the intact otherwise-qualified historical bundle is admitted under its own producer before current-producer rejection');
  assert.equal(await read(cold.importScanFingerprint),null,'old producer cannot replay corrected values as qualified facts');
  assert.deepEqual((await run({enabled:true,manifest,bundleDir,bundleFormat:'json'})).importsByFile[file],expected.toSorted());
  return {root,abs,stat,cold};
};
