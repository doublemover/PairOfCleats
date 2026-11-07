import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { buildChunkPayload } from '../../../src/index/build/file-processor/assemble.js';
import { buildTokenSequence } from '../../../src/index/build/tokenization.js';
import { buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { filterRawRelationsWithLexicon } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { createCallSites, enqueueCallSitesArtifacts } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { writeIncrementalBundle, readCachedBundle } from '../../../src/index/build/incremental.js';
import { resolveManifestBundleNames } from '../../../src/shared/bundle-io-paths.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createGraphStore } from '../../../src/graph/store.js';
import { readJsonLinesIterator } from '../../../src/shared/artifact-io/json.js';
import { enrichFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { assertProjection, digest } from './native-projection-workloads.js';
import { nativeOptions, cleanSamples } from './native-projection-observation.js';

const sha1 = value => createHash('sha1').update(value).digest('hex');
export const canonicalProjection = async (language, spec, rel) => {
  const text = spec.text, ext = '.' + language, options = nativeOptions(language);
  const input = { text, ext, relPath: rel, mode: 'code', options };
  const { lang, context } = await buildLanguageContext(input);
  const chunks = smartChunk({ ...input, context: { ...context, treeSitter: options.treeSitter } });
  const raw = lang.buildRelations({ ...input, context });
  const relations = filterRawRelationsWithLexicon(raw, { languageId: language, relKey: rel });
  const index = buildCallIndex(relations); attachCallDetailsByChunkIndex(index, chunks);
  const fileHash = sha1(text), ids = await prepareChunkIds({ chunks, text, relKey: rel, containerExt: ext,
    containerLanguageId: language, fileHash, fileHashAlgo: 'sha1', lineIndex: buildLineIndex(text), vfsManifestConcurrency: 1, strict: true });
  const payloads = chunks.map((chunk, chunkIndex) => {
    const tokenized = buildTokenSequence({ text: text.slice(chunk.start, chunk.end), mode: 'code', ext,
      dictWords: new Set(), dictConfig: {}, includeSeq: true });
    const codeRelations = buildChunkRelations({ lang, chunk, fileRelations: relations, callIndex: index, chunkIndex });
    const row = buildChunkPayload({ chunk: { ...chunk, ...ids.chunkLineRanges[chunkIndex] }, rel, relKey: rel, ext,
      effectiveExt: ext, languageId: language, fileHash, fileHashAlgo: 'sha1', fileSize: Buffer.byteLength(text),
      tokens: tokenized.tokens, tokenIds: [], seq: tokenized.seq, codeRelations,
      docmeta: enrichFlowFixture({ text, chunk, lang, context, options, enabled: false }), stats: {}, minhashSig: [],
      commentFieldTokens: [], dictWords: new Set(), dictConfig: {}, postingsConfig: {}, tokenMode: 'code',
      toolInfo: { tool: 'native-projection-costs', version: '1' }, gitMeta: {} });
    return row;
  });
  const sites = createCallSites({ chunks: payloads });
  return { language: lang.id, chunks, payloads, relations, fileHash, sites };
};
const verifyCanonical = (projected, language, spec) => {
  assert.equal(projected.language, language); assertProjection(projected.chunks, spec);
  assert.equal(projected.sites.length, spec.calls.length);
  for (const [index, row] of projected.payloads.entries()) {
    assert.equal(row.chunkUid, projected.chunks[index].chunkUid); assert.equal(row.metaV2.chunkUid, row.chunkUid);
    assert.equal(row.fileHash, sha1(spec.text));
  }
  for (const expected of spec.calls) {
    const caller = projected.payloads.find(row => row.name === expected.owner);
    assert.ok(projected.sites.some(site => site.callerChunkUid === caller.chunkUid
      && site.start === spec.text.indexOf(expected.needle) + (expected.prefix || '').length));
  }
};

export const observeIo = async operation => {
  const originalOpen = fs.open, originalReadFile = fs.readFile, originalWriteFile = fs.writeFile;
  const originalRename = fs.rename, originalRm = fs.rm, originalUnlink = fs.unlink, originalCreateWriteStream = nativeFs.createWriteStream;
  const descriptors = new Map(), outputStreams = new Set(), spillFiles = new Map();
  const counts = { opens: 0, closes: 0, peakLiveDescriptors: 0, liveDescriptors: 0, reads: 0, readBytes: 0,
    writes: 0, writeBytes: 0, readFiles: 0, readFileBytes: 0, writeFiles: 0, writeFileBytes: 0,
    outputStreams: 0, closedOutputStreams: 0, peakOutputQueuedBytes: 0, peakSpillBytes: 0, maximumSingleRunBytes: 0 };
  const spill = name => typeof name === 'string' && name.split(path.sep).includes('call_sites.runs');
  const written = (name, bytes) => {
    if (!spill(name)) return;
    spillFiles.set(name, bytes);
    counts.peakSpillBytes = Math.max(counts.peakSpillBytes, [...spillFiles.values()].reduce((sum, value) => sum + value, 0));
    if (path.basename(name).includes('.run-')) counts.maximumSingleRunBytes = Math.max(counts.maximumSingleRunBytes, bytes);
  };
  const forget = name => { for (const file of spillFiles.keys()) if (file === name || file.startsWith(name + path.sep)) spillFiles.delete(file); };
  nativeFs.createWriteStream = function(target, options) {
    const stream = Reflect.apply(originalCreateWriteStream, this, [target, options]);
    const name = typeof target === 'string' ? path.resolve(target) : descriptors.get(options?.fd);
    const write = stream.write;
    counts.outputStreams++; outputStreams.add(stream);
    stream.once('close', () => { counts.closedOutputStreams++; outputStreams.delete(stream); });
    stream.write = function(...args) {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : null;
      const result = Reflect.apply(write, this, [...args, function(error) {
        written(name, stream.bytesWritten);
        if (callback) Reflect.apply(callback, this, [error]);
      }]);
      counts.peakOutputQueuedBytes = Math.max(counts.peakOutputQueuedBytes,
        [...outputStreams].reduce((sum, output) => sum + output.writableLength, 0));
      return result;
    };
    return stream;
  };
  fs.rename = async (from, to) => {
    const result = await originalRename(from, to), source = path.resolve(String(from)), target = path.resolve(String(to));
    if (spillFiles.has(source)) { const bytes = spillFiles.get(source); spillFiles.delete(source); written(target, bytes); }
    return result;
  };
  fs.rm = async (target, ...args) => { const result = await originalRm(target, ...args); forget(path.resolve(String(target))); return result; };
  fs.unlink = async target => { const result = await originalUnlink(target); forget(path.resolve(String(target))); return result; };
  fs.readFile = async (...args) => { const value = await Reflect.apply(originalReadFile, fs, args);
    counts.readFiles++; counts.readFileBytes += Buffer.byteLength(value); return value; };
  fs.writeFile = async (...args) => { const value = await Reflect.apply(originalWriteFile, fs, args);
    counts.writeFiles++; counts.writeFileBytes += typeof args[1] === 'string' || Buffer.isBuffer(args[1]) ? Buffer.byteLength(args[1]) : 0; return value; };
  fs.open = async (...args) => {
    const handle = await Reflect.apply(originalOpen, fs, args); counts.opens++; counts.liveDescriptors++;
    descriptors.set(handle.fd, path.resolve(String(args[0])));
    counts.peakLiveDescriptors = Math.max(counts.peakLiveDescriptors, counts.liveDescriptors);
    const read = handle.read.bind(handle), write = handle.write.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...values) => { const result = await read(...values); counts.reads++; counts.readBytes += result.bytesRead; return result; };
    handle.write = async (...values) => { const result = await write(...values); counts.writes++; counts.writeBytes += result.bytesWritten; return result; };
    handle.close = async (...values) => { const fd = handle.fd, result = await close(...values);
      descriptors.delete(fd); counts.closes++; counts.liveDescriptors--; return result; };
    return handle;
  };
  try {
    const result = await operation();
    assert.equal(counts.liveDescriptors, 0); assert.equal(counts.opens, counts.closes);
    assert.equal(outputStreams.size, 0); assert.equal(counts.outputStreams, counts.closedOutputStreams);
    return { result, counts, scope: 'separate original promise-fs/WriteStream pass;API byte layers not additive physical device IO;output writableLength high-water;spill high-water at completed write callbacks including merge temporaries;compression-worker queues/native allocations excluded' };
  } finally {
    fs.open = originalOpen; fs.readFile = originalReadFile; fs.writeFile = originalWriteFile;
    fs.rename = originalRename; fs.rm = originalRm; fs.unlink = originalUnlink; nativeFs.createWriteStream = originalCreateWriteStream;
  }
};

export const bundleRefresh = async (language, root, saved, edited) => {
  await fs.mkdir(root); const bundleDir = path.join(root, 'bundles'); await fs.mkdir(bundleDir);
  const rel = 'changed.' + language, siblingRel = 'sibling.' + language;
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
  await fs.writeFile(path.join(root, rel), saved.text); await fs.writeFile(path.join(root, siblingRel), saved.text);
  const write = async (spec, name) => {
    const absolute = path.join(root, name);
    const fileStat = await fs.stat(absolute), projected = await canonicalProjection(language, spec, name);
    let priorSourceReplay = null;
    if (manifest.files[name] && manifest.files[name].hash !== projected.fileHash) {
      priorSourceReplay = await readCachedBundle({ repoRoot: root, enabled: true, absPath: absolute, relKey: name,
        fileStat, manifest, bundleDir, bundleFormat: 'json' });
    }
    manifest.files[name] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: name, fileStat,
      fileHash: projected.fileHash, fileChunks: projected.payloads, fileRelations: projected.relations, bundleFormat: 'json' });
    return { ...projected, fileStat, absolute, priorSourceReplay };
  };
  const cold = await cleanSamples(async () => ({ changed: await write(saved, rel), sibling: await write(saved, siblingRel) }),
    result => { verifyCanonical(result.changed, language, saved); verifyCanonical(result.sibling, language, saved);
      assert.ok(manifest.files[rel]); assert.ok(manifest.files[siblingRel]); }, { iterations: 1 });
  const original = cold.result, siblingEntry = structuredClone(manifest.files[siblingRel]);
  const siblingBytes = await Promise.all(resolveManifestBundleNames(siblingEntry).map(async name => ({ name,
    sha256: digest(await fs.readFile(path.join(bundleDir, name))) })));
  await fs.writeFile(path.join(root, rel), edited.text);
  const refresh = await cleanSamples(() => write(edited, rel), result => {
    verifyCanonical(result, language, edited); assert.ok(result.priorSourceReplay);
    assert.equal(result.priorSourceReplay.cachedBundle, null, 'old source identity cannot replay after the one-declaration edit');
    assert.ok(manifest.files[rel]);
  }, { iterations: 1 });
  assert.notEqual(refresh.result.fileHash, original.changed.fileHash);
  assert.deepEqual(manifest.files[siblingRel], siblingEntry, 'partial refresh leaves sibling publication entry unchanged');
  for (const row of siblingBytes) assert.equal(digest(await fs.readFile(path.join(bundleDir, row.name))), row.sha256);
  const replay = await cleanSamples(async () => {
    const rows = [];
    for (const [name, expected] of [[rel, refresh.result], [siblingRel, original.sibling]]) {
      const { cachedBundle } = await readCachedBundle({ repoRoot: root, enabled: true, absPath: expected.absolute, relKey: name,
        fileStat: expected.fileStat, manifest, bundleDir, bundleFormat: 'json' });
      rows.push({ cachedBundle, expected });
    }
    return rows;
  }, rows => {
    for (const { cachedBundle, expected } of rows) {
      assert.ok(cachedBundle); assert.deepEqual(cachedBundle.chunks, JSON.parse(JSON.stringify(expected.payloads)));
      assert.deepEqual(createCallSites({ chunks: cachedBundle.chunks }), expected.sites);
    }
  }, { iterations: 1 });
  const strip = value => ({ samples: value.samples, iterations: value.iterations, scope: value.scope });
  return { cold: strip(cold), partialRefresh: strip(refresh), replay: strip(replay), siblingBytes,
    unchangedSiblingUids: original.sibling.payloads.map(row => row.chunkUid), originalSourceHash: digest(saved.text),
    editedSourceHash: digest(edited.text), sourceReads: 'actual cached-bundle reader',
    scope: 'actual two-file canonical bundle publication, one-file refresh and exact replay;not a full buildIndex incremental benchmark' };
};

export const publishOccurrences = async (language, root, spec, compression = null) => {
  await fs.mkdir(root);
  const projected = await canonicalProjection(language, spec, 'wide.' + language), expected = projected.sites;
  verifyCanonical(projected, language, spec);
  assert.ok(expected.length > 96);
  const jobs = [], pieces = [], state = { chunks: projected.payloads };
  const before = digest(projected.payloads);
  const enqueueCpu = process.threadCpuUsage(), enqueueAt = performance.now();
  const result = await enqueueCallSitesArtifacts({ state, outDir: root, maxJsonBytes: 4096, spillBufferRows: 1, spillBufferBytes: 1024,
    compression, enqueueWrite: (_label, action) => jobs.push(action), addPieceFile: (entry, file) => pieces.push({
      entry: { ...entry, path: path.relative(root, file).replaceAll('\\', '/') }, file }),
    formatArtifactLabel: value => value });
  const enqueueSample = { phase: 'original-collection-and-spill', wallMs: performance.now() - enqueueAt, cpu: process.threadCpuUsage(enqueueCpu) };
  const runFiles = await fs.readdir(path.join(root, 'call_sites.runs'));
  const initialSpillStats = await Promise.all(runFiles.map(name => fs.stat(path.join(root, 'call_sites.runs', name))));
  const initialSpillBytes = initialSpillStats.reduce((sum, stat) => sum + stat.size, 0);
  assert.equal(result.totalEntries, expected.length); assert.ok(runFiles.length > 32);
  const writeCpu = process.threadCpuUsage(), writeAt = performance.now();
  for (const action of jobs) await action();
  const writeSample = { phase: 'original-merge-and-publication', wallMs: performance.now() - writeAt, cpu: process.threadCpuUsage(writeCpu) };
  assert.equal(digest(projected.payloads), before); assert.equal(state.callSitesCoverage.status, 'complete');
  assert.equal(state.callSitesCoverage.dropped, 0);
  await assert.rejects(fs.stat(path.join(root, 'call_sites.runs')), { code: 'ENOENT' });
  const readback = [];
  for (const piece of pieces.filter(piece => piece.entry.name === 'call_sites')) {
    for await (const row of readJsonLinesIterator(piece.file, { maxBytes: 1024 * 1024 })) readback.push(row);
  }
  assert.deepEqual(readback, expected);
  await writePiecesManifest({ outDir: root, mode: 'code', pieceEntries: pieces.map(piece => piece.entry),
    indexState: { buildId: 'projection-' + language + '-' + (compression || 'plain'), artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION } });
  const store = createGraphStore({ indexDir: root }), observed = [], pages = [];
  if (compression) {
    await assert.rejects(store.readCallSitesPage({ limit: 11, scanRows: 13 }), { code: 'ERR_CALL_SITE_PAGING_UNAVAILABLE' });
    const loaded = await cleanSamples(() => store.loadCallSites(), rows => assert.deepEqual(rows, expected), { iterations: 1 });
    pages.push({ unavailable: 'ERR_CALL_SITE_PAGING_UNAVAILABLE', originalCompressedLoaderSamples: loaded.samples,
      scope: 'compressed representation has no positioned page route;actual compatibility loader conserves all rows' });
    observed.push(...loaded.result);
  }
  let cursor = null;
  while (!compression) {
    const cpu = process.threadCpuUsage(), at = performance.now();
    const page = await store.readCallSitesPage({ cursor, limit: 11, scanRows: 13 });
    const sample = { wallMs: performance.now() - at, cpu: process.threadCpuUsage(cpu), bytes: page.bytes,
      scanned: page.scanned, rows: page.rows.length };
    assert.ok(page.rows.length <= 11 && page.scanned <= 13 && page.bytes <= 1024 * 1024);
    pages.push(sample); observed.push(...page.rows); cursor = page.cursor; assert.ok(pages.length < 100);
    if (cursor === null) break;
  }
  assert.deepEqual(observed, expected, 'published reader pages conserve every original canonical occurrence');
  const physical = await Promise.all(pieces.map(async ({ entry, file }) => { const bytes = await fs.readFile(file);
    return { path: entry.path, bytes: bytes.length, sha256: digest(bytes) }; }));
  return { compression, occurrences: expected.length, identity: digest(expected), physical,
    writeSamples: [enqueueSample, writeSample], initialSpillRuns: runFiles.length, initialSpillBytes,
    queuedWriteJobs: jobs.length, collectorBounds: { spillBufferRows: 1, spillBufferBytes: 1024, maxOpenMergeRuns: 32 }, pages,
    scope: 'actual canonical UID/native occurrence writer, bounded multi-pass spill, plain/gzip publication and manifest-backed graph pages;OS cache uncontrolled' };
};
