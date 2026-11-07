import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRenderSourceReader, MAX_RENDER_SOURCE_BYTES } from '../../../src/retrieval/output/source-snapshot.js';
import { createSourcePreviewReader } from '../../../src/retrieval/output/format/source.js';
import { formatFullChunk } from '../../../src/retrieval/output/format/full.js';
import { getBodySummary, getBodySummaryResult } from '../../../src/retrieval/output/summary.js';
import { configureOutputCaches, getFileTextCache, getSummaryCache } from '../../../src/retrieval/output/cache.js';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { createSearchOutputHitState, createSearchOutputOptions, captureSearchOutputStdout } from '../helpers/search-output-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('retrieval/output/summary-source-admission/')[1];
assert.ok(['oversize-render', 'cumulative-render', 'reuse', 'reuse-uncached', 'generation', 'scan-limit', 'zero-negative',
  'failed-read', 'racing-read', 'encoding', 'supplied-refusal', 'invalid-cache', 'output-controls'].includes(mode));
const { dir } = await prepareIsolatedTestCacheDir(`summary-source-${mode}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
const source = 'alpha beta gamma delta\n';
const files = new Set(), descriptors = new Map();
const hit = (file = 'source.js', text = source) => ({ id: Number(/\d+/u.exec(file)?.[0] || 0), file, name: 'fixture', kind: 'FunctionDeclaration',
  start: 0, end: text.length, startLine: 1, endLine: 1, score: 1, scoreType: 'sparse' });
const write = async (file, bytes) => {
  await fs.writeFile(path.join(repo, file), bytes); files.add(toRealPathSync(path.join(repo, file))); return hit(file);
};
await write('source.js', mode === 'oversize-render' ? 'unbudgeted_body_marker '.padEnd(MAX_RENDER_SOURCE_BYTES + 1, 'x') : source);
if (mode === 'cumulative-render') for (let i = 0; i < 5; i++) await write(`large-${i}.js`, source.padEnd(MAX_RENDER_SOURCE_BYTES, 'x'));
if (mode === 'scan-limit') await write('source.js', 'x'.repeat(128 * 1024));
if (mode === 'encoding') {
  const text = 'alpha βeta 😀\r\nzeta';
  await write('source.js', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
}
const original = { open: fsSync.openSync, read: fsSync.readSync, close: fsSync.closeSync, readFile: fsSync.readFileSync };
const observed = { descriptorReads: 0, physicalBytes: 0, directFileReads: 0, opened: 0, closed: 0 };
fsSync.openSync = function (input, ...args) {
  const fd = original.open.call(this, input, ...args);
  if (typeof input === 'string' && files.has(path.resolve(input))) { descriptors.set(fd, path.resolve(input)); observed.opened++; }
  return fd;
};
fsSync.readSync = function (fd, buffer, offset, length, position) {
  const file = descriptors.get(fd);
  if (!file) return original.read.call(this, fd, buffer, offset, length, position);
  observed.descriptorReads++;
  if (mode === 'failed-read') throw Object.assign(new Error('Fixture source read failed.'), { code: 'EIO' });
  const count = original.read.call(this, fd, buffer, offset, length, position); observed.physicalBytes += count;
  if (mode === 'racing-read') fsSync.writeFileSync(file, source + 'changed during read');
  return count;
};
fsSync.closeSync = function (fd) {
  const result = original.close.call(this, fd);
  if (descriptors.delete(fd)) observed.closed++;
  return result;
};
fsSync.readFileSync = function (file, ...args) {
  if (typeof file === 'string' && files.has(path.resolve(file))) observed.directFileReads++;
  return original.readFile.call(this, file, ...args);
};
const render = async (hits, overrides = {}) => captureSearchOutputStdout(() => renderSearchOutput(createSearchOutputOptions({
  emitOutput: true, jsonOutput: false, jsonCompact: false, rootDir: repo, plain: true, color, explain: true,
  ...createSearchOutputHitState({ codeHits: hits }), ...overrides
})));
try {
  const env = applyTestEnv({ syncProcess: false, extraEnv: {
    PAIROFCLEATS_FILE_CACHE_MAX: undefined, PAIROFCLEATS_SUMMARY_CACHE_MAX: undefined
  } });
  await withTemporaryEnv(env, async () => {
    configureOutputCaches({ cacheConfig: { fileText: { maxMb: mode === 'reuse-uncached' ? 0 : 4 },
      summary: { maxMb: mode === 'reuse-uncached' ? 0 : 1 } } });
    if (mode === 'oversize-render') {
      const output = await render([hit()]);
      assert.match(output, /Could not load summary/); assert.doesNotMatch(output, /unbudgeted_body_marker/);
      assert.equal(observed.physicalBytes, 0); assert.equal(observed.directFileReads, 0);
    } else if (mode === 'cumulative-render') {
      const output = await render(Array.from({ length: 5 }, (_, i) => hit(`large-${i}.js`)));
      assert.match(output, /large-4\.js/);
      assert.equal(observed.physicalBytes, 2 * 1024 * 1024);
      assert.equal(observed.directFileReads, 0, 'body summaries cannot create a second independent source reader');
    } else if (mode === 'reuse' || mode === 'reuse-uncached') {
      const preview = createSourcePreviewReader(repo);
      assert.equal(preview(hit()).lines[0], source.trimEnd());
      assert.equal(getBodySummary(repo, hit(), 3, { sourceReader: preview.sourceReader }), 'alpha beta gamma');
      assert.equal(getBodySummary(repo, { ...hit(), start: 11 }, 2, { sourceReader: preview.sourceReader }), 'gamma delta');
      assert.equal(observed.descriptorReads, 1); assert.equal(observed.physicalBytes, Buffer.byteLength(source));
      assert.equal(observed.closed, observed.opened);
      if (mode === 'reuse-uncached') { assert.equal(getFileTextCache().cache, null); assert.equal(getSummaryCache().cache, null); }
      else assert.equal(getBodySummary(repo, hit(), 3), 'alpha beta gamma');
      assert.equal(observed.descriptorReads, 1, 'a fresh render may reuse only the admitted generation-matching cache');
    } else if (mode === 'generation') {
      const owner = createRenderSourceReader(repo);
      assert.equal(getBodySummary(repo, hit(), 3, { sourceReader: owner }), 'alpha beta gamma');
      const changed = 'new fresh text now\n'; await fs.writeFile(path.join(repo, 'source.js'), changed);
      const refused = getBodySummaryResult(repo, hit(), 3, { sourceReader: owner });
      assert.equal(refused.state, 'unavailable'); assert.equal(refused.reason, 'source-changed');
      assert.equal(getBodySummary(repo, hit('source.js', changed), 4), 'new fresh text now');
      assert.equal(observed.descriptorReads, 2);
    } else if (mode === 'scan-limit') {
      const owner = createRenderSourceReader(repo);
      const result = getBodySummaryResult(repo, hit('source.js', 'x'.repeat(128 * 1024)), 1, { sourceReader: owner });
      assert.equal(result.state, 'truncated'); assert.equal(result.selectionComplete, false); assert.ok(result.text.length <= 4096);
      assert.ok(owner.stats().admittedScanChars <= 4 * 64 * 1024);
      const constrained = createRenderSourceReader(repo, { maxScanChars: 1 });
      assert.equal(getBodySummaryResult(repo, hit(), 1, { sourceReader: constrained }).state, 'unavailable');
    } else if (mode === 'zero-negative') {
      const owner = createRenderSourceReader(repo);
      for (const words of [0, -2, null, NaN]) assert.equal(getBodySummary(repo, hit(), words, { sourceReader: owner }), '');
      assert.doesNotMatch(formatFullChunk({ chunk: hit(), index: 4, mode: 'code', rootDir: repo, color, score: 1, scoreType: 'sparse',
        sourcePreview: null, sourceReader: owner, summaryState: { lastCount: 0 }, allowSummary: true }), /Summary/);
      assert.equal(owner.stats().fileAttempts, 0); assert.equal(owner.stats().admittedScanChars, 0);
      assert.equal(observed.physicalBytes, 0);
    } else if (mode === 'failed-read' || mode === 'racing-read') {
      const owner = createRenderSourceReader(repo, { maxFiles: 1, maxBytes: Buffer.byteLength(source) });
      assert.equal(owner.read(hit()).state, 'unavailable');
      assert.equal(getBodySummaryResult(repo, hit(), 3, { sourceReader: owner }).state, 'unavailable');
      assert.equal(observed.descriptorReads, 1); assert.equal(owner.stats().fileAttempts, 1);
      assert.equal(owner.stats().admittedBytes, Buffer.byteLength(source));
      assert.equal(owner.stats().physicalReadRequestedBytes, Buffer.byteLength(source));
      assert.equal(owner.stats().decodeBytes, 0); assert.equal(observed.closed, observed.opened);
    } else if (mode === 'encoding') {
      const text = 'alpha βeta 😀\r\nzeta', owner = createRenderSourceReader(repo);
      assert.equal(getBodySummary(repo, hit('source.js', text), 4, { sourceReader: owner }), 'alpha βeta 😀 zeta');
      assert.equal(getBodySummary(repo, { ...hit('source.js', text), start: text.indexOf('zeta') }, 1, { sourceReader: owner }), 'zeta');
      assert.equal(observed.descriptorReads, 1);
    } else if (mode === 'supplied-refusal') {
      const formatted = formatFullChunk({ chunk: hit(), index: 0, mode: 'code', rootDir: repo, color, score: 1, scoreType: 'sparse',
        sourcePreview: null, summaryState: { lastCount: 0 }, allowSummary: true, queryTokens: [] });
      assert.match(formatted, /Could not load summary/); assert.equal(observed.physicalBytes, 0);
    } else if (mode === 'invalid-cache') {
      const first = createRenderSourceReader(repo).read(hit()).snapshot;
      const forged = Object.create(null, { text: { get() { throw new Error('Unowned cache payload was inspected.'); } } });
      getFileTextCache().cache.set(first.key, forged, { size: 1 });
      assert.equal(getBodySummary(repo, hit(), 2), 'alpha beta');
      assert.equal(observed.descriptorReads, 2, 'an unowned cache value must trigger actual admitted source reading');
      const badOwner = { read() { throw new Error('Unowned reader must not run.'); } };
      assert.equal(getBodySummaryResult(repo, hit(), 2, { sourceReader: badOwner }).reason, 'invalid-source-owner');
    } else {
      JSON.parse(await render([hit()], { jsonOutput: true, jsonCompact: true }));
      assert.equal(observed.physicalBytes, 0, 'structured output has no working-tree summary read');
      assert.doesNotMatch(await render([hit()], { explain: false, showStats: false, showMatched: false }), /Summary/);
      assert.equal(observed.physicalBytes, Buffer.byteLength(source));
    }
    assert.equal(observed.directFileReads, 0, 'only the bounded original-descriptor owner may read source bytes');
    assert.equal(descriptors.size, 0, 'every observed descriptor must close before formatting returns');
  });
} finally {
  fsSync.openSync = original.open; fsSync.readSync = original.read; fsSync.closeSync = original.close; fsSync.readFileSync = original.readFile;
  configureOutputCaches();
}
console.log(`Render-owned body summary admission: ${mode}`);
