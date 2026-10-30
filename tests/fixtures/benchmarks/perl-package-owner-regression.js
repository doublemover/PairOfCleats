import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { applyTestEnv } from '../../helpers/test-env.js';

await requireBootstrap(); applyTestEnv();
const [arm, destination] = process.argv.slice(2);
assert.ok(['original', 'current'].includes(arm));
assert.ok(destination && path.isAbsolute(destination));
await fs.mkdir(destination);
const digest = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const target = new URL('../../../src/lang/tree-sitter/chunking.js', import.meta.url).href;
const physicalBaseline = await fs.readFile(new URL('./perl-chunking-original-24230.js.txt', import.meta.url));
const baseline = physicalBaseline.toString('utf8').replace(/\r\n/g, '\n');
assert.equal(digest(baseline), '7e3bf4993507e8b18cb6d0e61e591c34c0b946c1edc39c25e0b7f5d6cad8a000');
assert.equal(digest(Buffer.concat([Buffer.from('blob ' + Buffer.byteLength(baseline) + '\0'), Buffer.from(baseline)]), 'sha1'),
  'a463e75c435424152976171248bc303ac9b21648', 'exact issue-pinned original module, preserving LF source bytes');
let interceptions = 0;
const hook = arm === 'original' ? registerHooks({ load(url, context, next) {
  if (url !== target) return next(url, context);
  interceptions++;
  return { format: 'module', source: baseline, shortCircuit: true };
} }) : null;
const inputRoot = path.join(destination, 'input'); await fs.mkdir(inputRoot);
const rootIdentity = await fs.lstat(inputRoot, { bigint: true });
let failed = false, primary, report;
try {
  // Only this original production URL is substituted. All adapters, installed
  // grammar bindings, source coordinates and canonical consumers remain real.
  const { buildLanguageContext, buildChunkRelations } = await import('../../../src/index/language-registry.js');
  const { smartChunk } = await import('../../../src/index/chunking/dispatch.js');
  const { prepareChunkIds } = await import('../../../src/index/build/file-processor/process-chunks/ids.js');
  const { buildChunkPayload } = await import('../../../src/index/build/file-processor/assemble.js');
  const { buildTokenSequence } = await import('../../../src/index/build/tokenization.js');
  const { buildCallIndex } = await import('../../../src/index/build/file-processor/relations.js');
  const { attachCallDetailsByChunkIndex } = await import('../../../src/index/build/file-processor/process-chunks/dedupe.js');
  const { filterRawRelationsWithLexicon } = await import('../../../src/index/build/file-processor/lexicon-relations-filter.js');
  const { createCallSites } = await import('../../../src/index/build/artifacts/writers/call-sites.js');
  const { buildLineIndex, offsetToLine } = await import('../../../src/shared/lines.js');
  const { writeIncrementalBundle, readCachedBundle } = await import('../../../src/index/build/incremental.js');
  const { getNativeTreeSitterParser, getNativeTreeSitterIdentity } = await import('../../../src/lang/tree-sitter/native-runtime.js');
  const { ARTIFACT_SURFACE_VERSION } = await import('../../../src/contracts/versioning.js');
  const { enrichFlowFixture } = await import('../../helpers/chunk-flow-fixture.js');
  const ordered = rows => rows.map(row => JSON.stringify(row)).toSorted();
  const declarations = [
    { form: 'braced', source: 'package Demo {\nsub callee { return 1; }\nsub caller { callee(); }\n}\n',
      names: ['Demo.callee', 'Demo.caller'], snippets: ['sub callee { return 1; }', 'sub caller { callee(); }'],
      caller: 'Demo.caller', callee: 'callee', affected: ['Demo.callee', 'Demo.caller'] },
    { form: 'nested', source: 'package Demo {\nsub outer { sub helper { return 1; } helper(); }\n}\n',
      names: ['Demo.outer', 'Demo.outer.helper'], snippets: ['sub outer { sub helper { return 1; } helper(); }', 'sub helper { return 1; }'],
      caller: 'Demo.outer', callee: 'helper', affected: ['Demo.outer'] },
    { form: 'unbraced', source: 'package Demo;\nsub callee { return 1; }\nsub caller { callee(); }\n',
      names: ['callee', 'caller'], snippets: ['sub callee { return 1; }', 'sub caller { callee(); }'],
      caller: 'caller', callee: 'callee', affected: [] }
  ];
  const cases = [];
  for (const spec of declarations) {
    const source = spec.source, rel = spec.form + '.pl', absolute = path.join(inputRoot, rel);
    await fs.writeFile(absolute, source);
    const stat = await fs.stat(absolute), sourceHash = digest(source), fileHash = digest(source, 'sha1');
    const lineIndex = buildLineIndex(source), parser = getNativeTreeSitterParser('perl');
    assert.ok(parser, 'the actual installed patched Perl grammar is mandatory');
    const tree = parser.parse(source);
    try { assert.equal(tree.rootNode.hasError, false, tree.rootNode.toString()); }
    finally { tree.delete?.(); parser.reset?.(); }
    // Historical query instrumentation differs. This regression deliberately
    // uses real walk mode; existing repaired query/walk controls stay separate.
    const options = { treeSitter: { enabled: true, strict: true, adaptive: false, useQueries: false, chunkCache: false },
      astDataflowEnabled: false, controlFlowEnabled: false };
    const input = { text: source, ext: '.pl', relPath: rel, mode: 'code', options };
    const { lang, context } = await buildLanguageContext(input);
    assert.equal(lang.id, 'perl');
    const native = context.perlChunks;
    assert.ok(native?.length, 'registered preparation must retain actual native declarations');
    const expected = [{ name: 'Demo', kind: 'PackageDeclaration' }, ...spec.names.map(name => ({ name,
      kind: arm === 'original' && spec.affected.includes(name) ? 'MethodDeclaration' : 'FunctionDeclaration' }))];
    assert.deepEqual(native.map(({ name, kind }) => ({ name, kind })), expected,
      'the original arm must positively observe the wrong package role, never an incidental command failure');
    const chunks = smartChunk({ ...input, context });
    assert.deepEqual(chunks.map(({ name, kind }) => ({ name, kind })), expected);
    for (const [index, name] of spec.names.entries()) {
      const chunk = chunks.find(row => row.name === name), snippet = spec.snippets[index], start = source.indexOf(snippet);
      assert.ok(start >= 0); assert.equal(chunk.start, start); assert.equal(chunk.end, start + snippet.length);
      assert.equal(source.slice(chunk.start, chunk.end), snippet, 'independently authored original declaration span');
    }
    const expectedCalls = arm === 'original' && spec.affected.length ? [] : [[spec.caller, spec.callee]];
    const expectedExports = spec.names.filter(name => !(arm === 'original' && spec.affected.includes(name)));
    const raw = lang.buildRelations({ ...input, context });
    assert.deepEqual(ordered(raw.calls), ordered(expectedCalls));
    assert.deepEqual(raw.exports.toSorted(), expectedExports.toSorted());
    const filtered = filterRawRelationsWithLexicon(raw, { languageId: 'perl', relKey: rel });
    assert.deepEqual(ordered(filtered.calls), ordered(expectedCalls));
    assert.deepEqual(filtered.exports.toSorted(), expectedExports.toSorted());
    const callIndex = buildCallIndex(filtered); attachCallDetailsByChunkIndex(callIndex, chunks);
    const ids = await prepareChunkIds({ chunks, text: source, relKey: rel, containerExt: '.pl', containerLanguageId: 'perl',
      fileHash, fileHashAlgo: 'sha1', lineIndex, vfsManifestConcurrency: 1, strict: true });
    assert.equal(new Set(chunks.map(row => row.chunkUid)).size, chunks.length);
    const payloads = chunks.map((chunk, chunkIndex) => {
      const codeRelations = buildChunkRelations({ lang, chunk, fileRelations: filtered, callIndex, chunkIndex });
      assert.deepEqual(ordered(codeRelations.calls || []), ordered(expectedCalls.filter(([owner]) => owner === chunk.name)));
      assert.equal(ids.chunkLineRanges[chunkIndex].startLine, offsetToLine(lineIndex, chunk.start));
      assert.equal(ids.chunkLineRanges[chunkIndex].endLine, offsetToLine(lineIndex, Math.max(chunk.start, chunk.end - 1)));
      const tokenized = buildTokenSequence({ text: source.slice(chunk.start, chunk.end), mode: 'code', ext: '.pl',
        dictWords: new Set(), dictConfig: {}, includeSeq: true });
      const payload = buildChunkPayload({ chunk: { ...chunk, ...ids.chunkLineRanges[chunkIndex] },
        rel, relKey: rel, ext: '.pl', effectiveExt: '.pl', languageId: 'perl',
        fileHash, fileHashAlgo: 'sha1', fileSize: Buffer.byteLength(source), tokens: tokenized.tokens, tokenIds: [], seq: tokenized.seq,
        codeRelations, docmeta: enrichFlowFixture({ text: source, chunk, lang, context, options, enabled: false }),
        stats: {}, minhashSig: [], commentFieldTokens: [], dictWords: new Set(), dictConfig: {}, postingsConfig: {},
        tokenMode: 'code', toolInfo: { tool: 'perl-original-owner-regression', version: '1' }, gitMeta: {} });
      assert.equal(payload.chunkUid, chunk.chunkUid); assert.equal(payload.metaV2.chunkUid, chunk.chunkUid);
      assert.equal(payload.name, chunk.name); assert.equal(payload.kind, chunk.kind);
      assert.equal(payload.fileHash, fileHash); assert.equal(payload.fileHashAlgo, 'sha1');
      return payload;
    });
    const sites = createCallSites({ chunks: payloads });
    assert.equal(sites.length, expectedCalls.length);
    if (expectedCalls.length) {
      const owner = payloads.find(row => row.name === spec.caller);
      assert.ok(sites.some(site => site.callerChunkUid === owner.chunkUid
        && (site.calleeRaw === spec.callee || site.calleeNormalized === spec.callee)));
    }
    const bundleDir = path.join(inputRoot, spec.form + '-bundle'); await fs.mkdir(bundleDir);
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
    manifest.files[rel] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: rel, fileStat: stat,
      fileHash, fileChunks: payloads, bundleFormat: 'json', fileRelations: filtered });
    assert.ok(manifest.files[rel]);
    const { cachedBundle } = await readCachedBundle({ repoRoot: inputRoot, enabled: true, absPath: absolute, relKey: rel,
      fileStat: stat, manifest, bundleDir, bundleFormat: 'json' });
    assert.ok(cachedBundle);
    assert.deepEqual(cachedBundle.chunks, JSON.parse(JSON.stringify(payloads)), 'canonical identities and every persisted field survive actual replay');
    assert.deepEqual(cachedBundle.fileRelations, JSON.parse(JSON.stringify(filtered)));
    assert.deepEqual(createCallSites({ chunks: cachedBundle.chunks }), sites);
    assert.equal(digest(await fs.readFile(absolute)), sourceHash);
    cases.push({ form: spec.form, source, sourceHash, fileHash, sourceBytes: Buffer.byteLength(source),
      affected: spec.affected, rawCalls: raw.calls, filteredCalls: filtered.calls, exports: filtered.exports,
      callSites: sites, identities: payloads.map(row => ({ name: row.name, kind: row.kind, start: row.start, end: row.end,
        startLine: row.startLine, endLine: row.endLine, chunkUid: row.chunkUid,
        sourceSliceHash: digest(source.slice(row.start, row.end)), tokens: row.tokens, calls: row.codeRelations.calls || [] })),
      replay: 'exact-full-payload-and-relations', assertion: arm === 'original' && spec.affected.length
        ? 'old-wrong-roles-and-lost-relations-positively-observed' : 'free-function-calls-and-exports-retained' });
  }
  assert.equal(interceptions, arm === 'original' ? 1 : 0, 'exact named owner load must execute once in the original arm');
  report = { arm, cases, grammar: getNativeTreeSitterIdentity('perl'), owner: {
    path: 'src/lang/tree-sitter/chunking.js', interceptions,
    ...(arm === 'original' ? { revision: '24230d7960127ab7e4a01f2c040bf3d859f6b46b',
      gitBlob: 'a463e75c435424152976171248bc303ac9b21648', sha256: digest(baseline), physicalFixtureSha256: digest(physicalBaseline) }
      : { sha256: digest(await fs.readFile(fileURLToPath(target))) }) },
  scope: 'exact original chunking owner versus repaired owner under current real dependencies;native walk, registry, limits, canonical UID/payload/call-sites and immutable bundle replay',
  limits: 'no historical whole-checkout, query performance, Perl interpreter or full-index claim;no failure is accepted as the old-bug oracle' };
} catch (error) { failed = true; primary = error; throw error; }
finally {
  let cleanupFailed = false, cleanupFailure;
  try { hook?.deregister(); }
  catch (cleanup) { cleanupFailed = true; cleanupFailure = cleanup; }
  try {
    if (failed) observeStorageResource(primary, { phase: 'perl-original-owner-cleanup' }).requireSettled();
    const after = await fs.lstat(inputRoot, { bigint: true });
    assert.ok(after.isDirectory() && !after.isSymbolicLink() && after.dev === rootIdentity.dev && after.ino === rootIdentity.ino);
    assert.equal(path.dirname(inputRoot), destination);
    await fs.rm(inputRoot, { recursive: true, force: false });
  } catch (cleanup) {
    cleanupFailure = cleanupFailed ? addStorageFailureContext(cleanupFailure, {}, cleanup, { secondaryPresent: true }) : cleanup;
    cleanupFailed = true;
  }
  if (cleanupFailed) {
    if (failed) throw addStorageFailureContext(primary, { phase: 'perl-original-owner-cleanup' }, cleanupFailure, { secondaryPresent: true });
    throw cleanupFailure;
  }
}
await atomicWriteJson(path.join(destination, 'receipt.json'), { schemaVersion: 1, status: 'passed', historicalAuthorWorkspace: true,
  node: process.version, platform: process.platform, pid: process.pid, generatedWork: 'original uniquely owned input removed', report }, { createOnly: true });
