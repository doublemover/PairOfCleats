import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { __setAdapterFactoryForTests, __resetEmbeddingAdapterCachesForTests } from '../../../../src/shared/embedding-adapter.js';
import { postprocessEmbeddingChannels } from '../../../../src/shared/embedding-postprocess.js';
import { isDenseVectorRowPresent } from '../../../../src/shared/dense-vector-validity.js';
import { resolveRepoCacheRootPath } from '../../../../src/shared/repo-paths.js';
import { parseBuildEmbeddingsArgs } from '../../../../tools/build/embeddings/args.js';
import { runBuildEmbeddingsWithConfig } from '../../../../tools/build/embeddings/runner.js';
import { resolveGlobalChunkCacheDir, resolveCacheRoot } from '../../../../tools/build/embeddings/cache.js';
import { createBaseIndex } from '../../validate/helpers.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('chunk-channel-cache-routes/')[1];
assert.ok(['cross-file', 'prior-file', 'global'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`chunk-channel-${selected}`);
const repo = path.join(dir, 'repo'), models = path.join(dir, 'models'), model = 'fixture/channel-identity';
const modelDir = path.join(models, 'fixture', 'channel-identity'), graph = path.join(modelDir, 'model.onnx');
await fs.mkdir(repo); await fs.mkdir(modelDir, { recursive: true });
if (selected !== 'cross-file') {
  await fs.writeFile(graph, 'inert identity-qualified model'); await fs.writeFile(path.join(modelDir, 'tokenizer.json'), '{"inert":1}');
}
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'real', extraEnv: { PAIROFCLEATS_HOME: path.join(dir, 'home') },
  testConfig: { threads: 1, sqlite: { use: false }, indexing: { scm: { provider: 'none' },
    postings: { enablePhraseNgrams: false, enableChargrams: false, fielded: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false,
    embeddings: { enabled: true, mode: 'inline', provider: 'xenova', normalize: false, fileParallelism: 1,
      adaptiveFileParallelism: false, persistentTextCache: false, crossFileChunkDedupe: selected === 'cross-file',
      hnsw: { enabled: false }, lancedb: { enabled: false } } }, tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } } });
const cacheRepo = resolveRepoCacheRootPath(repo, {}), embeddingCache = path.join(dir, 'embedding-cache');
const a = { code: 'alpha\nbeta', doc: 'gamma' }, b = { code: 'alpha', doc: 'beta\ngamma' };
assert.equal(`${a.code}\n${a.doc}`, `${b.code}\n${b.doc}`, 'original serialization collision witness');
const vector = text => Float32Array.from(createHash('sha256').update(text).digest().subarray(0, 4), value => value / 255 * 2 - 1);
let seen = [], loads = 0, run = 0;
__setAdapterFactoryForTests(() => {
  loads++;
  return { provider: selected === 'cross-file' ? 'xenova' : 'onnx', embedderPromise: null,
    embed: async texts => { seen.push(...texts); return texts.map(vector); }, dispose: async () => {} };
});
const build = async files => {
  const buildId = `channel-${selected}-${++run}`, chunks = [], inputs = [];
  for (const [file, channels] of files) {
    let text = '';
    for (const channel of channels) {
      const start = text.length; text += channel.code;
      chunks.push({ id: chunks.length, file, start, end: text.length, kind: 'function', name: `chunk-${chunks.length}`,
        docmeta: channel.doc === null ? {} : { doc: channel.doc } });
      inputs.push(channel); text += '\n';
    }
    await fs.writeFile(path.join(repo, file), text);
  }
  const { indexRoot: buildRoot } = await createBaseIndex({ rootDir: path.join(cacheRepo, 'builds', buildId), chunkMeta: chunks,
    semantic: true, manifestOverrides: { buildId, mode: 'code', stage: 'stage2' },
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode: 'code', buildId, generatedAt: new Date().toISOString() },
    tokenPostings: { vocab: ['alpha'], postings: [chunks.map(row => [row.id, 1])], docLengths: chunks.map(() => 1), avgDocLen: 1, totalDocs: chunks.length } });
  const config = parseBuildEmbeddingsArgs(['--repo', repo, '--index-root', buildRoot, '--mode', 'code', '--progress', 'off', '--model', model]);
  config.modelsDir = models; config.configuredDims = 4; config.argv.dims = 4;
  config.embeddingsConfig.cache = { dir: embeddingCache };
  if (selected !== 'cross-file') { config.embeddingProvider = 'onnx'; config.embeddingOnnx = { modelPath: graph, tokenizerId: model }; }
  seen = []; await runBuildEmbeddingsWithConfig(config);
  const indexDir = path.join(buildRoot, 'index-code');
  for (const [channel, base] of [['quantizedCode', 'dense_vectors_code_uint8'], ['quantizedDoc', 'dense_vectors_doc_uint8'], ['quantizedMerged', 'dense_vectors_uint8']]) {
    const bytes = await fs.readFile(path.join(indexDir, `${base}.bin`));
    const metadata = JSON.parse(await fs.readFile(path.join(indexDir, `${base}.meta.json`), 'utf8'));
    assert.equal(bytes.length, inputs.length * 4, 'every new ordinal must be written exactly once');
    inputs.forEach((input, ordinal) => {
      const expected = postprocessEmbeddingChannels({ codeVector: vector(input.code), docVector: input.doc === null ? [] : vector(input.doc), normalize: false });
      assert.equal(isDenseVectorRowPresent(metadata, ordinal), expected[channel].length > 0, 'absence is recorded in the authoritative validity mask');
      assert.deepEqual([...bytes.subarray(ordinal * 4, ordinal * 4 + 4)], [...(expected[channel].length ? expected[channel] : new Uint8Array(4).fill(metadata.zeroPoint))], `${selected} ${channel} ordinal ${ordinal}`);
    });
  }
  const state = JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8'));
  assert.equal(state.embeddings.ready, true);
  return { calls: [...seen], identity: state.embeddings.embeddingIdentity, state };
};
try {
  if (selected === 'cross-file') {
    const result = await build([['00-a.txt', [a]], ['01-b.txt', [b]], ['02-a-copy.txt', [a]]]);
    for (const input of [a.code, a.doc, b.code, b.doc]) assert.equal(result.calls.filter(text => text === input).length, 1,
      'separate channels infer once, while an identical later file reuses the framed channels');
    assert.equal(result.identity.modelArtifact.reuse, 'refuse', 'durable caches cannot hide the in-memory route');
    await assert.rejects(fs.stat(embeddingCache), { code: 'ENOENT' });
  } else {
    const first = await build([['same.txt', [a]]]);
    assert.equal(first.identity.modelArtifact.reuse, 'allow');
    if (selected === 'prior-file') {
      // The completed run owns only this disposable fixture cache. Remove its
      // global route, retaining the real prior-file index/payload as sole proof.
      const cacheRoot = resolveCacheRoot({ repoCacheRoot: cacheRepo, cacheDirConfig: embeddingCache, scope: 'repo' });
      const global = resolveGlobalChunkCacheDir(cacheRoot, first.identity);
      assert.ok(path.relative(embeddingCache, global) && !path.relative(embeddingCache, global).startsWith('..'));
      await fs.rm(global, { recursive: true });
      const second = await build([['same.txt', [b, a, a]]]);
      for (const input of [b.code, b.doc]) assert.ok(second.calls.includes(input), 'channel moves must infer the changed channel pair');
      for (const input of [a.code, a.doc]) assert.equal(second.calls.filter(text => text === input).length, 1,
        'one prior occurrence supplies one new ordinal; the extra duplicate still requires inference');
      const edited = { ...b, doc: 'edited documentation only' };
      const third = await build([['same.txt', [edited, a, a]]]);
      assert.ok(third.calls.includes(edited.doc), 'a doc-only edit with unchanged source bytes must not reuse the earlier doc/merged channels');
    } else {
      const second = await build([['different.txt', [b]]]);
      for (const input of [b.code, b.doc]) assert.ok(second.calls.includes(input), 'B cannot receive A from the global cache');
      const third = await build([['identical.txt', [a]]]);
      for (const input of [a.code, a.doc]) assert.equal(third.calls.includes(input), false, 'identical channels still hit the global route without a same-file entry');
      const absent = await build([['absent-doc.txt', [{ ...a, doc: null }]]]);
      assert.equal(absent.calls.includes(a.doc), false, 'absent documentation cannot borrow a present doc channel');
    }
  }
  assert.ok(loads > 0, 'the inert input-identifying adapter must be exercised');
} finally { __resetEmbeddingAdapterCachesForTests(); await fs.rm(dir, { recursive: true, force: true }); }
console.log(`Production ${selected} cache route preserves exact code/doc vectors and new ordinals.`);
