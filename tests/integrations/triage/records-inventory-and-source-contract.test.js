import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createRecordsMarkdownInventory } from '../../../src/integrations/triage/records-inventory.js';
import { analyzeLiteralText } from '../../../src/shared/text-analyzer.js';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { persistIncrementalManifest } from '../../../src/index/build/incremental/manifest-codec.js';
import { createQueryAstHelpers } from '../../../src/retrieval/pipeline/query-ast.js';

const { dir } = await prepareIsolatedTestCacheDir('records-inventory-source-contract');
const root = path.join(dir, 'repo'), recordsDir = path.join(root, 'records'), repoCacheRoot = path.join(dir, 'repo-cache');
await fs.mkdir(path.join(recordsDir, 'a'), { recursive: true }); await fs.mkdir(path.join(recordsDir, 'b'));
const originalText = '# CaseSensitive ﬃ ㍿ Café Cafe\u0301 😀\r\nOriginal second line.\r\n';
const firstFile = path.join(recordsDir, 'a', 'first.md'), secondFile = path.join(recordsDir, 'b', 'second.md');
await fs.writeFile(firstFile, originalText); await fs.writeFile(secondFile, 'Second complete source.\n');
const missing = createRecordsMarkdownInventory(path.join(dir, 'missing'));
assert.deepEqual(await Array.fromAsync(missing.files), []); assert.equal(missing.receipt().outcome, 'optional-missing');
const emptyDir = path.join(dir, 'empty'); await fs.mkdir(emptyDir);
const empty = createRecordsMarkdownInventory(emptyDir);
assert.deepEqual(await Array.fromAsync(empty.files), []); assert.equal(empty.receipt().outcome, 'complete');
const inventory = createRecordsMarkdownInventory(recordsDir);
assert.throws(() => inventory.receipt(), /no complete terminal receipt/);
assert.deepEqual(await Array.fromAsync(inventory.files), [firstFile, secondFile]);
assert.equal(inventory.receipt().complete, true); assert.equal(inventory.receipt().files, 2);
assert.ok(inventory.receipt().sortRowsHighWater <= 256); assert.ok(inventory.receipt().sortBytesHighWater <= 256 * 1024);
const canceled = new AbortController(); canceled.abort();
await assert.rejects(Array.fromAsync(createRecordsMarkdownInventory(recordsDir, { signal: canceled.signal }).files), { name: 'AbortError' });

const captureKey = Symbol.for('test.records.source-publication');
const captures = [], embeddingInputs = [];
globalThis[captureKey] = input => { captures.push({ chunks: structuredClone(input.state.chunks), indexState: structuredClone(input.indexState) }); };
const hook = registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    return resolved.url.endsWith('/index/build/artifacts.js') ? { ...resolved, url: resolved.url + '?records-publication-fixture' } : resolved;
  },
  load(url, context, next) {
    if (url.endsWith('/index/build/artifacts.js?records-publication-fixture')) return { format: 'module', shortCircuit: true,
      source: `export * from ${JSON.stringify(url.split('?')[0] + '?actual-records-fixture')};
        export const writeIndexArtifacts = input => globalThis[Symbol.for('test.records.source-publication')](input);` };
    return next(url, context);
  }
});
const runtime = { root, buildRoot: path.join(dir, 'build'), repoCacheRoot,
  userConfig: { cache: { root: path.join(dir, 'cache') }, triage: { recordsDir } },
  postingsConfig: { enablePhraseNgrams: true, enableChargrams: true, fielded: true }, dictWords: new Set(), dictConfig: {},
  modelId: 'stub-model', useStubEmbeddings: true, workerPool: null,
  getChunkEmbedding: async text => { embeddingInputs.push(text); return []; },
  profile: { id: 'default' }, indexingConfig: { profile: 'default' }, embeddingEnabled: false, embeddingService: false,
  incrementalEnabled: true, incrementalBundleFormat: 'json', shards: { enabled: false }, twoStage: { enabled: false } };
const opendir = fs.opendir, lstat = fs.lstat, open = fs.open;
try {
  const { buildRecordsIndexForRepo } = await import('../../../src/integrations/triage/index-records.js');
  const run = abortSignal => buildRecordsIndexForRepo({ runtime, abortSignal });
  const incremental = () => loadIncrementalState({ repoRoot: root, repoCacheRoot, mode: 'records', enabled: true, bundleFormat: 'json' });
  await run(); assert.equal(captures.length, 1);
  const first = captures[0].chunks.find(chunk => chunk.file.endsWith('a/first.md'));
  assert.ok(first); assert.equal(first.start, 0); assert.equal(first.end, originalText.length);
  assert.deepEqual(first.metaV2.range, { start: 0, end: originalText.length, startLine: 1, endLine: 3 });
  assert.equal(first.fileHash, createHash('sha1').update(Buffer.from(originalText)).digest('hex'));
  assert.deepEqual(first.phraseTokens, analyzeLiteralText(originalText, { caseSensitive: true }));
  assert.notDeepEqual(first.phraseTokens, analyzeLiteralText(originalText.normalize('NFKD'), { caseSensitive: true }));
  assert.ok(first.phraseTokens.includes('ﬃ')); assert.equal(first.phraseTokens.includes('ffi'), false);
  for (const [phrase, expected] of [['CaseSensitive ﬃ', true], ['casesensitive ﬃ', false], ['CaseSensitive ffi', false]]) {
    const ast = { type: 'phrase', tokens: analyzeLiteralText(phrase, { caseSensitive: true }), caseSensitive: true };
    assert.equal(createQueryAstHelpers({ queryAst: ast }).matchesQueryAst({ chunkMeta: [first] }, 0, first), expected,
      'literal matching uses the original compatibility-character representation');
  }
  assert.ok(first.tokens.includes('ffi'), 'compatibility expansion remains available to scoring without changing literal/source coordinates');
  assert.ok(embeddingInputs.includes(originalText), 'source embedding input is explicit and retains the original decoded representation');
  assert.equal(captures[0].indexState.extensions.recordsInventory.triage.complete, true);
  embeddingInputs.length = 0; await run(); assert.equal(embeddingInputs.length, 0, 'qualified unchanged products reuse without embedding work');
  const warm = captures.at(-1).chunks.find(chunk => chunk.file === first.file);
  assert.deepEqual(warm, first);
  runtime.incrementalEnabled = false; await run(); runtime.incrementalEnabled = true;
  const fresh = captures.at(-1).chunks.find(chunk => chunk.file === first.file);
  for (const key of ['chunkUid', 'fileHash', 'start', 'end', 'metaV2', 'phraseTokens', 'tokens']) assert.deepEqual(fresh[key], first[key], key);
  const old = await incremental();
  old.manifest.files[first.file].dependencySignatures.recordsProducer = 'legacy-records-producer-7';
  await persistIncrementalManifest(old.manifestPath, old.manifest);
  embeddingInputs.length = 0; await run(); assert.ok(embeddingInputs.includes(originalText), 'old producer receipts cannot reuse corrected products');
  const prior = await incremental(), beforeManifest = await fs.readFile(prior.manifestPath);
  for (const code of ['EACCES', 'EIO', 'EMFILE', 'ENOENT']) {
    const original = Object.freeze(Object.assign(new Error('controlled child inventory ' + code), { code }));
    fs.opendir = async (target, ...args) => {
      if (path.relative(path.resolve(String(target)), path.join(recordsDir, 'b')) === '') throw original;
      return opendir.call(fs, target, ...args);
    };
    const publications = captures.length;
    await assert.rejects(run(), error => (error === original || error.cause === original) && error.recordsInventory.complete === false);
    assert.equal(captures.length, publications);
    assert.deepEqual(await fs.readFile(prior.manifestPath), beforeManifest, 'unknown subtree cannot publish completion or prune prior unseen inputs');
    fs.opendir = opendir;
  }
  for (const [method, file] of [['stat', secondFile], ['read', firstFile]]) {
    const original = Object.freeze(Object.assign(new Error('controlled record ' + method), { code: 'EIO' }));
    if (method === 'stat') fs.lstat = async (target, ...args) => {
      if (path.resolve(String(target)) === path.resolve(file)) throw original;
      return lstat.call(fs, target, ...args);
    };
    else fs.open = async (target, ...args) => {
      if (path.resolve(String(target)) === path.resolve(file)) throw original;
      return open.call(fs, target, ...args);
    };
    const count = captures.length;
    await assert.rejects(run(), error => {
      const stack = [error], seen = new Set();
      while (stack.length) {
        const item = stack.pop(); if (item === original) return true;
        if (!item || typeof item !== 'object' || seen.has(item)) continue;
        seen.add(item); stack.push(item.cause, ...(item.errors || []));
      }
      return false;
    });
    assert.equal(captures.length, count); assert.deepEqual(await fs.readFile(prior.manifestPath), beforeManifest);
    fs.lstat = lstat; fs.open = open;
  }
  const sidecar = secondFile.slice(0, -3) + '.json';
  for (const invalid of ['{', '[]']) {
    await fs.writeFile(sidecar, invalid); const count = captures.length;
    await assert.rejects(run(), /Cannot establish record sidecar identity/);
    assert.equal(captures.length, count); assert.deepEqual(await fs.readFile(prior.manifestPath), beforeManifest,
      'malformed canonical sidecars cannot publish complete records or prune the prior manifest');
  }
  await fs.unlink(sidecar);
  const during = new AbortController();
  fs.opendir = async (target, ...args) => {
    const handle = await opendir.call(fs, target, ...args);
    if (path.relative(path.resolve(String(target)), path.join(recordsDir, 'a')) === '') during.abort();
    return handle;
  };
  const publications = captures.length;
  await assert.rejects(run(during.signal), { name: 'AbortError' });
  assert.equal(captures.length, publications); assert.deepEqual(await fs.readFile(prior.manifestPath), beforeManifest);
} finally { fs.opendir = opendir; fs.lstat = lstat; fs.open = open; hook.deregister(); delete globalThis[captureKey]; }
console.log('records inventory completion and original source coordinates retain fresh/replay parity');
