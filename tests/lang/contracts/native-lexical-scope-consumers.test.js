import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { filterRawRelationsWithLexicon } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { buildChunkPayload } from '../../../src/index/build/file-processor/assemble.js';
import { buildTokenSequence } from '../../../src/index/build/tokenization.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { buildLineIndex, offsetToLine } from '../../../src/shared/lines.js';
import { writeIncrementalBundle, readCachedBundle } from '../../../src/index/build/incremental.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { resolveChunkCacheKey, resolvePersistentChunkCachePaths } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { TREE_SITTER_CHUNK_VERSION } from '../../../src/lang/tree-sitter/config.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { enrichFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('lang/contracts/native-lexical-scope-consumers/')[1];
assert.ok(['ruby', 'php', 'scala', 'groovy', 'r'].includes(selected));
const type = (name, kind) => ({ name, kind });
// These source labels, kinds, exports and edges are independent authored
// oracles. In particular, a semicolon namespace is not a lexical AST parent.
const specifications = {
  ruby: [{ ext: '.rb', source: [
    'module Outer', ' class Inner', '  def ping()', '   alpha()', '  end', ' end', 'end',
    'module Other', ' class Inner', '  def ping()', '   beta()', '  end', ' end', 'end', ''
  ].join('\n'), expected: [type('Outer', 'ModuleDeclaration'), type('Outer.Inner', 'ClassDeclaration'),
    type('Outer.Inner.ping', 'MethodDeclaration'), type('Other', 'ModuleDeclaration'),
    type('Other.Inner', 'ClassDeclaration'), type('Other.Inner.ping', 'MethodDeclaration')],
  exports: ['Outer', 'Outer.Inner', 'Other', 'Other.Inner'],
  calls: [['Outer.Inner.ping', 'alpha'], ['Other.Inner.ping', 'beta']] }],
  php: ['braced', 'semicolon'].map(form => ({ ext: '.php', form,
    source: ['<?php', form === 'braced' ? 'namespace Api {' : 'namespace Api;',
      'function ping() { alpha(); }', 'class Box { public function run() { beta(); } }',
      ...(form === 'braced' ? ['}', 'namespace Other {'] : ['namespace Other;']),
      'function ping() { gamma(); }', ...(form === 'braced' ? ['}'] : []), ''].join('\n'),
    expected: [type('Api', 'NamespaceDeclaration'), type('Api.ping', 'FunctionDeclaration'),
      type('Api.Box', 'ClassDeclaration'), type('Api.Box.run', 'MethodDeclaration'),
      type('Other', 'NamespaceDeclaration'), type('Other.ping', 'FunctionDeclaration')],
    exports: ['Api', 'Api.ping', 'Api.Box', 'Api.Box.run', 'Other', 'Other.ping'],
    calls: [['Api.ping', 'alpha'], ['Api.Box.run', 'beta'], ['Other.ping', 'gamma']] })),
  scala: [{ ext: '.scala', source: [
    'object Box {', ' def first(): Int = {', '  def helper(): Int = { alpha(); 1 }', '  helper()', ' }',
    ' def second(): Int = {', '  def helper(): Int = { beta(); 2 }', '  helper()', ' }', '}', ''
  ].join('\n'), expected: [type('Box', 'ObjectDeclaration'), type('Box.first', 'MethodDeclaration'),
    type('Box.first.helper', 'FunctionDeclaration'), type('Box.second', 'MethodDeclaration'),
    type('Box.second.helper', 'FunctionDeclaration')],
  exports: ['Box', 'Box.first', 'Box.first.helper', 'Box.second', 'Box.second.helper'],
  calls: [['Box.first', 'helper'], ['Box.first.helper', 'alpha'], ['Box.second', 'helper'], ['Box.second.helper', 'beta']] }],
  groovy: [{ ext: '.groovy', source: [
    'class Alpha {', ' class Inner {', '  void same() { alpha(); }', ' }', '}',
    'class Beta {', ' class Inner {', '  void same() { beta(); }', ' }', '}', ''
  ].join('\n'), expected: [type('Alpha', 'ClassDeclaration'), type('Alpha.Inner', 'ClassDeclaration'),
    type('Alpha.Inner.same', 'MethodDeclaration'), type('Beta', 'ClassDeclaration'),
    type('Beta.Inner', 'ClassDeclaration'), type('Beta.Inner.same', 'MethodDeclaration')],
  exports: ['Alpha', 'Alpha.Inner', 'Alpha.Inner.same', 'Beta', 'Beta.Inner', 'Beta.Inner.same'],
  calls: [['Alpha.Inner.same', 'alpha'], ['Beta.Inner.same', 'beta']] }],
  r: [{ ext: '.r', source: [
    'alpha <- function(x) {', ' helper <- function(y) { beta(y) }', ' helper(x)', '}',
    'gamma <- function(x) {', ' helper <- function(y) { delta(y) }', ' helper(x)', '}', ''
  ].join('\n'), expected: ['alpha', 'alpha.helper', 'gamma', 'gamma.helper'].map(name => type(name, 'FunctionDeclaration')),
  exports: ['alpha', 'alpha.helper', 'gamma', 'gamma.helper'],
  calls: [['alpha', 'helper'], ['alpha.helper', 'beta'], ['gamma', 'helper'], ['gamma.helper', 'delta']] }]
};
const ordered = rows => rows.map(row => JSON.stringify(row)).toSorted();
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const { dir } = await prepareIsolatedTestCacheDir('native-lexical-scope-' + selected);
const observations = [];
try {
  for (const [index, spec] of specifications[selected].entries()) {
    const source = spec.source, rel = 'fixture-' + index + spec.ext, abs = path.join(dir, rel);
    await fs.writeFile(abs, source);
    const stat = await fs.stat(abs), lineIndex = buildLineIndex(source), cacheRoot = path.join(dir, 'native-' + index);
    const parser = getNativeTreeSitterParser(selected); assert.ok(parser, 'actual installed grammar is required');
    const tree = parser.parse(source);
    try { assert.equal(tree.rootNode.hasError, false, tree.rootNode.toString()); }
    finally { tree.delete?.(); parser.reset?.(); }
    let prior;
    for (const useQueries of [false, true]) {
      const options = { treeSitter: { enabled: true, strict: true, adaptive: false, useQueries,
        chunkCache: true, cachePersistent: true, cachePersistentDir: cacheRoot,
        cacheKey: 'scope-' + digest(source) }, astDataflowEnabled: false, controlFlowEnabled: false };
      const input = { text: source, ext: spec.ext, relPath: rel, mode: 'code', options };
      const project = async () => {
        const { lang, context } = await buildLanguageContext(input);
        assert.equal(lang.id, selected);
        const native = context[selected + 'Chunks']; assert.ok(native?.length, 'registered native preparation cannot fall back');
        assert.ok(native.every(chunk => Number.isInteger(chunk.meta?.definitionStart) && !chunk.meta?.wholeFile));
        const chunks = smartChunk({ ...input, context: { ...context, treeSitter: options.treeSitter } });
        assert.deepEqual(ordered(chunks.map(({ name, kind }) => ({ name, kind }))), ordered(spec.expected));
        const raw = lang.buildRelations({ ...input, context });
        assert.deepEqual(ordered(raw.calls), ordered(spec.calls), 'raw native ownership must distinguish same-named nested declarations');
        assert.deepEqual(raw.exports.toSorted(), spec.exports.toSorted());
        const relations = filterRawRelationsWithLexicon(raw, { languageId: selected, relKey: rel });
        assert.deepEqual(ordered(relations.calls), ordered(spec.calls), 'lexicon keeps the independently expected calls');
        const callIndex = buildCallIndex(relations); attachCallDetailsByChunkIndex(callIndex, chunks);
        const ids = await prepareChunkIds({ chunks, text: source, relKey: rel, containerExt: spec.ext,
          containerLanguageId: selected, lineIndex, vfsManifestConcurrency: 1, strict: true });
        assert.equal(new Set(chunks.map(chunk => chunk.chunkUid)).size, chunks.length);
        const payloads = chunks.map((chunk, chunkIndex) => {
          assert.ok(chunk.meta.definitionStart >= chunk.start && chunk.meta.definitionEnd <= chunk.end);
          assert.equal(ids.chunkLineRanges[chunkIndex].startLine, offsetToLine(lineIndex, chunk.start));
          assert.equal(ids.chunkLineRanges[chunkIndex].endLine, offsetToLine(lineIndex, chunk.end - 1));
          const codeRelations = buildChunkRelations({ lang, chunk, fileRelations: relations, callIndex, chunkIndex });
          assert.deepEqual(ordered(codeRelations.calls || []), ordered(spec.calls.filter(([name]) => name === chunk.name)));
          const tokenized = buildTokenSequence({ text: source.slice(chunk.start, chunk.end), mode: 'code', ext: spec.ext,
            dictWords: new Set(), dictConfig: {}, includeSeq: true });
          const payload = buildChunkPayload({ chunk: { ...chunk, ...ids.chunkLineRanges[chunkIndex], spanIndex: chunkIndex },
            rel, relKey: rel, ext: spec.ext, effectiveExt: spec.ext, languageId: selected,
            fileHash: digest(source, 'sha1'), fileHashAlgo: 'sha1', fileSize: Buffer.byteLength(source),
            tokens: tokenized.tokens, tokenIds: [], seq: tokenized.seq, codeRelations,
            docmeta: enrichFlowFixture({ text: source, chunk, lang, context, options, enabled: false }),
            stats: {}, minhashSig: [], commentFieldTokens: [], dictWords: new Set(), dictConfig: {}, postingsConfig: {},
            tokenMode: 'code', toolInfo: { tool: 'native-scope-fixture', version: '1' }, gitMeta: {} });
          assert.equal(payload.chunkUid, chunk.chunkUid, 'canonical UID is passed unchanged into actual payload assembly');
          assert.equal(payload.metaV2.chunkUid, chunk.chunkUid);
          assert.equal(payload.name, chunk.name); assert.equal(payload.kind, chunk.kind);
          return payload;
        });
        const sites = createCallSites({ chunks: payloads });
        assert.equal(sites.length, spec.calls.length, 'every original invocation survives canonical call-site publication');
        for (const [caller, callee] of spec.calls) {
          const owner = payloads.find(chunk => chunk.name === caller);
          assert.ok(sites.some(site => site.callerChunkUid === owner.chunkUid
            && (site.calleeRaw === callee || site.calleeNormalized === callee)), `${caller} -> ${callee}`);
        }
        return { chunks, payloads, relations, witness: payloads.map(row => ({ name: row.name, kind: row.kind,
          start: row.start, end: row.end, uid: row.chunkUid, calls: row.codeRelations.calls || [] })) };
      };
      const queryBefore = treeSitterState.metrics.queryExecutions || 0;
      const cold = await project();
      if (useQueries) assert.ok((treeSitterState.metrics.queryExecutions || 0) > queryBefore, 'actual Query route executes');
      const hits = treeSitterState.metrics.chunkCacheHits || 0;
      const warm = await project();
      assert.ok((treeSitterState.metrics.chunkCacheHits || 0) > hits, 'same source has an actual native cache hit');
      assert.deepEqual(warm.witness, cold.witness);
      if (prior) assert.deepEqual(cold.witness, prior, 'query/traversal retain exact names, ranges, canonical UIDs and edges');
      prior = cold.witness;
      const bundleDir = path.join(dir, `bundles-${index}-${useQueries}`); await fs.mkdir(bundleDir);
      const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
      manifest.files[rel] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: rel, fileStat: stat,
        fileHash: digest(source, 'sha1'), fileChunks: cold.payloads, bundleFormat: 'json', fileRelations: cold.relations });
      const { cachedBundle } = await readCachedBundle({ repoRoot: dir, enabled: true, absPath: abs, relKey: rel,
        fileStat: stat, manifest, bundleDir, bundleFormat: 'json' });
      assert.ok(cachedBundle);
      assert.deepEqual(cachedBundle.chunks, JSON.parse(JSON.stringify(cold.payloads)), 'all JSON-persisted payload fields survive replay');
      assert.deepEqual(ordered(cachedBundle.fileRelations.calls), ordered(spec.calls));
      // Poison an actual persisted cache only by changing its producer identity
      // and one old wrong label. The canonical loader must reparse this source.
      const key = resolveChunkCacheKey(options, selected), paths = resolvePersistentChunkCachePaths(cacheRoot, key);
      const stored = JSON.parse(await fs.readFile(paths.canonical, 'utf8'));
      stored.producerVersion = '17'; stored.chunks[0].name = 'retired_wrong_scope';
      await fs.writeFile(paths.canonical, JSON.stringify(stored));
      treeSitterState.chunkCache.delete(key); treeSitterState.persistentChunkCacheMemo.delete(key);
      treeSitterState.persistentChunkCacheMisses.delete(key);
      assert.deepEqual((await project()).witness, cold.witness, 'retired scope meaning cannot survive persisted replay');
      observations.push({ language: selected, form: spec.form || null, useQueries, sourceSha256: digest(source),
        expectedNames: spec.expected.map(row => row.name), calls: spec.calls, producer: TREE_SITTER_CHUNK_VERSION });
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(JSON.stringify({ selected, observations, scope: 'actual installed native grammar, registered projection, canonical UID/payload/call-site and bounded cache/bundle replay' }));
