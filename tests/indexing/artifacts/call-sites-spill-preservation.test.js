import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCallSites, enqueueCallSitesArtifacts } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { readJsonLinesIterator } from '../../../src/shared/artifact-io/json.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), 'call-sites-spill-preservation');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
const chunks = [{ id: 0, file: 'unicode-\u03bb.scala', chunkUid: 'owner', lang: 'scala',
  codeRelations: { callDetails: Array.from({ length: 110 }, (_, i) => ({
    source: 'tree-sitter', coordinateSystem: 'utf16', role: i % 2 ? 'call' : 'construct',
    calleeRaw: i % 2 ? 'beta' : 'obj[index]', callee: i % 2 ? 'beta' : null,
    start: i * 12, end: i * 12 + 10, startLine: i + 1, endLine: i + 1, startCol: 1, endCol: 11,
    resolution: 'unresolved', reason: i % 2 ? 'syntax-target-unresolved' : 'dynamic-callee', args: []
  })).reverse() } }];
const original = structuredClone(chunks);
const expected = createCallSites({ chunks });
const spaced = structuredClone(chunks);
spaced[0].codeRelations.callDetails = [{ ...spaced[0].codeRelations.callDetails[0], calleeRaw: 'obj ["a  b"]' }];
assert.equal(createCallSites({ chunks: spaced })[0].calleeRaw, 'obj ["a  b"]',
  'native preview bytes preserve whitespace inside dynamic literal receivers');
const readRows = async files => {
  const rows = [];
  for (const file of files) for await (const row of readJsonLinesIterator(file, { maxBytes: 1024 * 1024 })) rows.push(row);
  return rows;
};
const enqueue = async (outDir, options = {}) => {
  await fs.mkdir(outDir, { recursive: true });
  const jobs = [], pieces = [], state = { chunks: structuredClone(chunks) };
  const result = await enqueueCallSitesArtifacts({ state, outDir, maxJsonBytes: 1024 * 1024,
    spillBufferRows: 1, spillBufferBytes: 1024, ...options,
    enqueueWrite: (_label, job) => jobs.push(job), addPieceFile: (entry, file) => pieces.push({ entry, file }),
    formatArtifactLabel: value => value });
  return { jobs, pieces, state, result };
};
try {
  for (const [name, options] of [['plain', {}], ['sharded', { maxJsonBytes: 4096 }],
    ['compressed', { maxJsonBytes: 4096, compression: 'gzip' }]]) {
    const outDir = path.join(root, name);
    const pending = await enqueue(outDir, options);
    assert.equal(pending.result.totalEntries, 110, 'the occurrence tail survives beyond 96 and 128-style inference policies');
    assert.ok((await fs.readdir(path.join(outDir, 'call_sites.runs'))).length > 32,
      'fixture forces bounded fan-in merge passes instead of one reader per run');
    for (const job of pending.jobs) await job();
    const rows = await readRows(pending.pieces.filter(piece => piece.entry.name === 'call_sites').map(piece => piece.file));
    assert.deepEqual(rows, expected, `${name} canonical bytes, dynamic/construct roles, coordinates and identities match`);
    assert.equal(pending.state.callSitesCoverage.status, 'complete');
    assert.equal(pending.state.callSitesCoverage.dropped, 0);
    assert.deepEqual(pending.state.chunks, original, 'publication leaves immutable inputs unchanged');
    await assert.rejects(fs.stat(path.join(outDir, 'call_sites.runs')), { code: 'ENOENT' });
  }
  const controller = new AbortController();
  const interruptedDir = path.join(root, 'interrupted');
  const interrupted = await enqueue(interruptedDir, { abortSignal: controller.signal });
  controller.abort();
  await assert.rejects(interrupted.jobs[0](), /abort/i);
  assert.equal(interrupted.state.callSitesCoverage.status, 'incomplete');
  assert.ok((await fs.readdir(path.join(interruptedDir, 'call_sites.runs'))).length > 32);
  const resumed = await enqueue(interruptedDir);
  for (const job of resumed.jobs) await job();
  assert.deepEqual(await readRows(resumed.pieces.filter(piece => piece.entry.name === 'call_sites').map(piece => piece.file)), expected);
  const invalid = structuredClone(chunks); delete invalid[0].codeRelations.callDetails[0].startLine;
  assert.throws(() => createCallSites({ chunks: invalid }), { code: 'ERR_SYNTAX_CALL_SITE_INVALID' },
    'invalid syntax facts fail publication instead of disappearing');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Canonical call-site spill, fan-in, formats, interruption and retry preservation controls passed.');
