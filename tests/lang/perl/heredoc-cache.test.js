import assert from 'node:assert/strict';
import { buildPerlChunks } from '../../../src/lang/perl.js';
import { buildLocalCacheKey } from '../../../src/shared/cache-key.js';
import { TREE_SITTER_CHUNK_VERSION } from '../../../src/lang/tree-sitter/config.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { getTreeSitterStats, resetTreeSitterStats } from '../../../src/lang/tree-sitter.js';
import { ensureChunkCache, resolveChunkCacheKey, resolvePersistentChunkCacheRoot,
  storeCachedChunks, loadCachedChunks } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { buildIncrementalSignaturePayload, buildIncrementalSignatureSummary } from '../../../src/index/build/indexer/signatures.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('perl-heredoc-cache');
const source = "my $x = <<'END';\nsub fake { die 'literal'; }\nEND\nsub actual { return $x; }\n";
const options = { treeSitter: { enabled: true, useQueries: false, adaptive: false,
  cacheKey: 'same-source-and-options', chunkCache: true, cachePersistent: true, cachePersistentDir: dir } };
const legacyKey = buildLocalCacheKey({ namespace: 'tree-sitter-chunk', payload: {
  producerVersion: '2', languageId: 'perl', key: options.treeSitter.cacheKey,
  signature: { useQueries: false, maxBytes: null, maxLines: null, maxParseMs: null,
    maxAstNodes: null, maxAstStack: null, maxChunkNodes: null, adaptive: false, configChunking: false }
} }).key;
const currentKey = resolveChunkCacheKey(options, 'perl');
assert.notEqual(currentKey, legacyKey, 'the old parser meaning cannot share a chunk cache key');
const { cache, maxEntries } = ensureChunkCache(options);
const persistentRoot = resolvePersistentChunkCacheRoot(options);
storeCachedChunks({ cache, maxEntries, key: legacyKey, cacheRoot: persistentRoot,
  chunks: [{ start: 0, end: source.length, name: 'fake', kind: 'FunctionDeclaration', meta: { treeSitter: true } }] });
cache.clear(); treeSitterState.persistentChunkCacheMemo.clear();
assert.equal(loadCachedChunks({ cache, key: legacyKey, cacheRoot: persistentRoot })[0].name, 'fake',
  'a real persisted legacy row must exist before testing version admission');
resetTreeSitterStats();
const parser = getNativeTreeSitterParser('perl');
assert.ok(parser);
const parse = parser.parse;
let parseCalls = 0;
parser.parse = function (...args) { parseCalls++; return Reflect.apply(parse, this, args); };
try {
  const cold = buildPerlChunks(source, options);
  assert.deepEqual(cold.map(c => c.name), ['actual']);
  assert.equal(parseCalls, 1, 'the corrected native parser must actually run');
  assert.equal(Number(getTreeSitterStats().fallbacks) || 0, 0, 'heuristic fallback cannot supply passing evidence');
  assert.deepEqual(buildPerlChunks(source, options), cold, 'warm memory cache retains corrected content');
  treeSitterState.chunkCache.clear();
  treeSitterState.persistentChunkCacheMemo.clear();
  treeSitterState.persistentChunkCacheMisses.clear();
  assert.deepEqual(buildPerlChunks(source, options), cold, 'warm disk cache retains corrected content');
  assert.equal(parseCalls, 1, 'memory and persisted hits must avoid reparsing');
  assert.ok(getTreeSitterStats().chunkCachePersistentHits >= 1);
  const payload = buildIncrementalSignaturePayload({}, 'code', null);
  assert.equal(payload.nativeChunkProducer, TREE_SITTER_CHUNK_VERSION);
  assert.notEqual(buildIncrementalSignatureSummary({ nativeChunkProducer: payload.nativeChunkProducer }).nativeChunkProducer,
    buildIncrementalSignatureSummary({ nativeChunkProducer: '2' }).nativeChunkProducer,
    'incremental reuse also rejects the old scanner meaning');
} finally { parser.parse = parse; }
console.log('Old author caches cannot inject heredoc declarations; cold and warm cache contents match.');
