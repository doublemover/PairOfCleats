import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildHeuristicAdapters } from '../../../src/index/language-registry/adapters/heuristic.js';
import { buildTreeSitterChunks, buildTreeSitterChunksAsync } from '../../../src/lang/tree-sitter/chunking.js';
import { ensureChunkCache, resolveChunkCacheKey } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { preflightNativeTreeSitterGrammars } from '../../../src/lang/tree-sitter/native-runtime.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';

const require = createRequire(import.meta.url);
const preflight = preflightNativeTreeSitterGrammars(['csharp', 'groovy']);
assert.equal(preflight.ok, true, JSON.stringify(preflight));
const csharpVersion = require('tree-sitter-c-sharp/package.json').version;
assert.equal(csharpVersion, '0.23.5');
// This is the asynchronous vendor wrapper that the synchronous N-API loader
// must accommodate, not an older CommonJS stand-in.
assert.match(fs.readFileSync(require.resolve('tree-sitter-c-sharp'), 'utf8'), /\bawait\b/);
const options = { treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: false } };
const csharp = 'public class Road { public int Double(int x) { return x * 2; } }\n';
const csharpChunks = buildTreeSitterChunks({ text: csharp, languageId: 'csharp', ext: '.cs', options });
assert.ok(csharpChunks.some((chunk) => chunk.name === 'Road'));
assert.ok(csharpChunks.some((chunk) => chunk.name === 'Road.Double'));
assert.ok(csharpChunks.every((chunk) => chunk.meta.parserCoverage === undefined));

const groovy = 'class Road { int doubleValue(int x) { return x * 2 } }\n';
const control = 'class Road { int doubleValue(int x) { return x * 2; } }\n';
for (const useQueries of [false, true]) {
  for (const [text, recovered] of [[groovy, true], [control, false]]) {
    const chunks = buildTreeSitterChunks({
      text, languageId: 'groovy', ext: '.groovy',
      options: { treeSitter: { ...options.treeSitter, useQueries } }
    });
    assert.ok(chunks.some((chunk) => chunk.name === 'Road'));
    assert.ok(chunks.some((chunk) => chunk.name === 'Road.doubleValue'));
    assert.ok(chunks.every((chunk) => chunk.meta.parserCoverage === 'partial'));
    assert.ok(chunks.every((chunk) => chunk.meta.parserRecovered === recovered));
    assert.ok(chunks.every((chunk) => chunk.start >= 0 && chunk.end <= text.length));
  }
}

const wholeFile = buildTreeSitterChunks({
  text: 'println "hello"\n', languageId: 'groovy', ext: '.groovy', options
});
assert.equal(wholeFile[0].meta.wholeFile, true);
assert.equal(wholeFile[0].meta.parserCoverage, 'partial');

const cachedOptions = {
  treeSitterCacheKey: 'groovy-coverage-fixture',
  treeSitter: { ...options.treeSitter, chunkCache: true }
};
treeSitterState.chunkCache.clear();
const cachedInput = { text: groovy, languageId: 'groovy', ext: '.groovy', options: cachedOptions };
const fresh = buildTreeSitterChunks(cachedInput);
assert.deepEqual(buildTreeSitterChunks(cachedInput), fresh);
assert.deepEqual(await buildTreeSitterChunksAsync(cachedInput), fresh);
// A legacy cached envelope cannot establish whether the parser recovered.
const cache = ensureChunkCache(cachedOptions).cache;
cache.set(resolveChunkCacheKey(cachedOptions, 'groovy'), [{
  start: 0, end: groovy.length, name: 'file', kind: 'File', meta: { wholeFile: true }
}]);
const legacy = await buildTreeSitterChunksAsync(cachedInput);
assert.equal(legacy[0].meta.parserCoverage, 'partial');
assert.equal(legacy[0].meta.parserRecovered, null);
treeSitterState.chunkCache.clear();

const adapter = buildHeuristicAdapters().find((entry) => entry.id === 'groovy');
assert.equal(adapter.capabilityProfile.state, 'partial');
assert.equal(adapter.capabilityProfile.diagnostics[0].reasonCode, 'USR-R-HEURISTIC-ONLY');
const relations = await adapter.buildRelations({
  text: 'import road.Helpers\n' + groovy, options: { ext: '.groovy', relPath: 'Road.groovy' }
});
assert.ok(relations.imports.includes('road.Helpers'));
console.log(`C# ${csharpVersion} synchronous loader and Groovy partial/recovered coverage passed`);
