import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { writeIncrementalBundle, readCachedImports } from '../../../src/index/build/incremental.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createImportExtraction,importExtractionRuntimeVersions } from '../../../src/shared/import-extraction.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

/** Real source scan and durable import bundle; lexical partial receipts must
 * refresh, never gain parser authority merely because their values are right. */
export const assertEscapedImportReplay = async ({ name, file, source, expected }) => {
  const { dir: root } = await prepareIsolatedTestCacheDir(name);
  const abs = path.join(root,file); await fs.mkdir(path.dirname(abs),{recursive:true}); await fs.writeFile(abs,source);
  const stat = await fs.stat(abs), bundleDir = path.join(root,'bundles'); await fs.mkdir(bundleDir);
  const manifest = { artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,bundleFormat:'json',files:{} };
  const run = incrementalState => scanImports({root,files:[{abs,rel:file,stat}],mode:'code',importConcurrency:1,
    languageOptions:{treeSitter:{enabled:false},pythonAst:{enabled:false},collectorNow:()=>0},incrementalState});
  const cold = await run(); assert.deepEqual(cold.importsByFile[file],expected.toSorted());
  const fingerprint = producer => sha1(stableStringifyForSignature({ producer,
    extractionRuntime:importExtractionRuntimeVersions(),node:process.versions.node,mode:'code',languageOptions:{} }));
  assert.equal(cold.importScanFingerprint,fingerprint(SEMANTIC_ANALYSIS_VERSIONS.importResolution));
  const write = (identity,imports=expected,extraction=cold.importExtractionByFile[file]) => writeIncrementalBundle({enabled:true,bundleDir,manifest,relKey:file,fileStat:stat,
    fileHash:sha1(source),fileChunks:[],bundleFormat:'json',fileRelations:{imports,
      importScanFingerprint:identity,importScanExtraction:extraction}});
  manifest.files[file] = await write(cold.importScanFingerprint);
  const read = fingerprint => readCachedImports({enabled:true,absPath:abs,relKey:file,fileStat:stat,manifest,bundleDir,
    bundleFormat:'json',expectedImportScanFingerprint:fingerprint});
  assert.equal(await read(cold.importScanFingerprint),null,'partial lexical scans retain refresh-required policy');
  assert.deepEqual((await run({enabled:true,manifest,bundleDir,bundleFormat:'json'})).importsByFile[file],expected.toSorted());
  const obsolete=['phantom-from-retired-producer'];
  manifest.files[file] = await write(fingerprint('26'),obsolete,createImportExtraction({entries:obsolete,text:source,
    producerId:'historical-qualified-fixture',parser:{id:'historical-parser',version:'1',available:true},
    parserCoverage:'complete',scope:'historical-producer-output'}));
  assert.equal(await read(cold.importScanFingerprint),null,'old producer cannot replay corrected values as qualified facts');
  assert.deepEqual((await run({enabled:true,manifest,bundleDir,bundleFormat:'json'})).importsByFile[file],expected.toSorted());
  return {root,abs,stat,cold};
};
