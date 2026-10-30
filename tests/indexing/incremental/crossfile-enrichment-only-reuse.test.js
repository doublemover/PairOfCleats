import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseJavaScriptAst, buildJsChunks, buildCodeRelations } from '../../../src/lang/javascript.js';
import { buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { buildChunkRelations } from '../../../src/index/language-registry.js';
import { runCrossFilePropagation } from '../../../src/index/type-inference-crossfile/propagation.js';
import { writeIncrementalBundle, updateBundlesWithChunks } from '../../../src/index/build/incremental.js';
import { readIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { sha1 } from '../../../src/shared/hash.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('crossfile-enrichment-only-reuse');
const bundleDir = path.join(dir, 'bundles'), manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: {} };
const callerSource = 'import { factory } from "./factory.js"; function caller() { return factory(); }';
const run = async type => {
  const sources = { 'factory.js': `export function factory() { return new ${type}(); }`, 'caller.js': callerSource };
  const chunks = [], fileRelations = new Map();
  for (const [file, text] of Object.entries(sources)) {
    await fs.writeFile(path.join(dir, file), text);
    const ast = parseJavaScriptAst(text, { ext: '.js' }), raw = buildJsChunks(text, { ext: '.js', ast });
    const relations = buildCodeRelations(text, file, { ext: '.js', ast }), index = buildCallIndex(relations);
    attachCallDetailsByChunkIndex(index, raw); fileRelations.set(file, relations);
    for (const [chunkIndex, entry] of raw.entries()) chunks.push({ file, id: file === 'caller.js' ? 1 : 0,
      chunkId: `chunk:${entry.name}`, chunkUid: `uid:${entry.name}`, virtualPath: file, fileHash: sha1(text),
      fileHashAlgo: 'sha1', name: entry.name, kind: entry.kind, start: entry.start, end: entry.end, lang: 'javascript',
      metaV2: { symbol: { scheme: 'poc', qualifiedName: entry.name, symbolId: `symbol:${entry.name}`,
        symbolKey: `key:${entry.name}`, kindGroup: 'function' } },
      docmeta: file === 'factory.js' ? { returnType: type, exported: true, exportNames: ['factory'] } : {},
      codeRelations: buildChunkRelations({ chunk: entry, fileRelations: relations, callIndex: index, chunkIndex }) });
  }
  await runCrossFilePropagation({ rootDir: dir, chunks, fileRelations, enableTypeInference: true,
    enableRiskCorrelation: false, useTooling: false });
  return { chunks, fileRelations };
};
try {
  const first = await run('Widget');
  const caller = first.chunks.find(chunk => chunk.file === 'caller.js');
  assert.deepEqual([...new Set(caller.docmeta.inferredTypes?.returns?.map(row => row.type))], ['Widget']);
  for (const chunk of first.chunks) manifest.files[chunk.file] = await writeIncrementalBundle({ enabled: true,
    bundleDir, relKey: chunk.file, fileStat: await fs.stat(path.join(dir, chunk.file)), fileHash: chunk.fileHash,
    fileChunks: [chunk], fileRelations: first.fileRelations.get(chunk.file), vfsManifestRows: [] });
  const prior = manifest.files['caller.js'], priorNames = [...prior.bundles], priorHash = prior.hash;
  const changed = await run('Gadget'), nextCaller = changed.chunks.find(chunk => chunk.file === 'caller.js');
  assert.equal(nextCaller.fileHash, caller.fileHash, 'changing the imported file leaves caller source bytes unchanged');
  assert.deepEqual([...new Set(nextCaller.docmeta.inferredTypes.returns.map(row => row.type))], ['Gadget']);
  await updateBundlesWithChunks({ enabled: true, manifest, bundleDir, chunks: [nextCaller],
    fileRelations: changed.fileRelations, log: () => {} });
  assert.equal(manifest.files['caller.js'].hash, priorHash);
  assert.notDeepEqual(manifest.files['caller.js'].bundles, priorNames, 'neighbor-only type propagation replaces this source-stable snapshot');
  const loaded = await readIncrementalBundleSnapshot({ bundleDir, relKey: 'caller.js', entry: manifest.files['caller.js'] });
  assert.deepEqual(loaded.bundle.chunks[0].docmeta, nextCaller.docmeta);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual imported-file return-type propagation replaces a caller snapshot with unchanged source identity.');
