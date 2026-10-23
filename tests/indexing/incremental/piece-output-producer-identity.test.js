import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDependencySignatures, buildIncrementalSignature } from '../../../src/index/build/indexer/signatures.js';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { persistIncrementalManifest } from '../../../src/index/build/incremental/manifest-codec.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { runNode } from '../../helpers/run-node.js';

const root = await makeTempDir('poc-piece-producer-identity-');
const runtime = { languageOptions: {}, indexingConfig: { artifacts: { format: 'json' } },
  embeddingEnabled: false, profile: { id: 'default' } };
try {
  const preload = path.join(root, 'historical-output-producer.mjs');
  await fs.writeFile(preload, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){
    const loaded=next(url,context);if(!url.endsWith('/src/index/semantic/analysis-versions.js'))return loaded;
    const source=Buffer.from(loaded.source).toString('utf8');
    if(!/pieceAssembly: '[0-9]+'/.test(source))throw new Error('Missing canonical physical producer');
    return {...loaded,source:source.replace(/pieceAssembly: '[0-9]+'/,"pieceAssembly: '2'")};
  }});`);
  const moduleUrl = pathToFileURL(path.resolve('src/index/build/indexer/signatures.js')).href;
  const script = `import {buildDependencySignatures,buildIncrementalSignature} from ${JSON.stringify(moduleUrl)};
    const runtime=${JSON.stringify(runtime)};
    console.log(JSON.stringify({dependencies:buildDependencySignatures(runtime,'code','tokens'),
      signature:buildIncrementalSignature(runtime,'code','tokens')}));`;
  const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const child = runNode(['--import', pathToFileURL(preload).href, '--input-type=module', '-e', script],
    'historical physical output identity', process.cwd(), env, { timeoutMs: 5000, stdio: 'pipe', allowFailure: true });
  assert.equal(child.status, 0, child.stderr);
  const old = JSON.parse(child.stdout), current = buildDependencySignatures(runtime, 'code', 'tokens');
  for (const family of ['parse', 'lexical', 'enrichment', 'embeddings']) assert.equal(current[family], old.dependencies[family], family);
  assert.notEqual(current.artifacts, old.dependencies.artifacts, 'old hot-only physical output cannot lend the new assembly identity');
  assert.equal(buildIncrementalSignature(runtime, 'code', 'tokens'), old.signature,
    'an output repair preserves unchanged per-file content bundles');
  const before = await loadIncrementalState({ repoCacheRoot: root, mode: 'code', enabled: true,
    cacheSignature: old.signature, tokenizationKey: 'tokens', dependencySignatures: old.dependencies });
  before.manifest.files = { 'src/kept.js': { hash: 'unchanged', size: 4, mtimeMs: 1, bundle: 'kept.json' } };
  await persistIncrementalManifest(before.manifestPath, before.manifest);
  const after = await loadIncrementalState({ repoCacheRoot: root, mode: 'code', enabled: true,
    cacheSignature: old.signature, tokenizationKey: 'tokens', dependencySignatures: current });
  assert.deepEqual(after.manifest.files, before.manifest.files);
  assert.equal(after.artifactNeedsRebuild, true, 'actual planning refuses whole-mode artifact reuse');
} finally { await rmDirRecursive(root); }
console.log('Physical assembly producer changes rebuild output while retaining source/parse/lexical bundles.');
