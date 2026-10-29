#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { assertGraphEvidence } from '../../../src/contracts/validators/graph-evidence.js';
import { getBuildsRoot } from '../../../src/shared/repo-paths.js';
import { enqueueCallSitesArtifacts } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { runGraphEvidence } from '../../../src/integrations/tooling/graph-evidence.js';
import { createApiRouter } from '../../../tools/api/router.js';
import { handleToolCall } from '../../../tools/mcp/tools.js';
import { getToolDefs } from '../../../src/integrations/mcp/defs.js';

const root = resolveTestCachePath(process.cwd(), 'public-retained-graph-evidence');
await fs.rm(root, { recursive: true, force: true });
const repoRoot = path.join(root, 'repo'), cacheRoot = path.join(root, 'cache');
await fs.mkdir(repoRoot, { recursive: true });
const userConfig = { cache: { root: cacheRoot } };
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify(userConfig));
applyTestEnv({ testing: '1', cacheRoot });
let server, router;
try {
  const buildId = 'retained-public-one', buildsRoot = getBuildsRoot(repoRoot, userConfig);
  const outDir = path.join(buildsRoot, buildId, 'index-code');
  await fs.mkdir(outDir, { recursive: true });
  const callDetails = Array.from({ length: 9 }, (_, i) => ({ source: 'tree-sitter', coordinateSystem: 'utf16',
    role: 'call', callee: null, calleeRaw: 'dynamic[index]', start: i * 30, end: i * 30 + 16,
    startLine: i + 1, startCol: 1, endLine: i + 1, endCol: 17,
    reason: 'dynamic-call-target', rawPreviewTruncated: false }));
  const state = { chunks: [{ id: 0, file: 'source-😀.js', chunkUid: 'caller', name: 'caller',
    start: 0, end: 300, lang: 'javascript', kind: 'FunctionDeclaration', codeRelations: { callDetails } }] };
  const jobs = [], pieceEntries = [];
  await enqueueCallSitesArtifacts({ state, outDir, buildId, buildRoot: path.dirname(outDir), maxJsonBytes: 65536,
    enqueueWrite: (_label, operation) => jobs.push(operation),
    addPieceFile: (entry, file) => pieceEntries.push({ ...entry, path: path.relative(outDir, file).replaceAll('\\', '/') }),
    formatArtifactLabel: value => value });
  for (const job of jobs) await job();
  await writePiecesManifest({ pieceEntries, outDir, mode: 'code',
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId } });
  const request = { schemaVersion: 1, repoRoot, buildId, family: 'call_sites',
    filter: { chunkUid: 'caller', direction: 'out' }, limits: { rows: 2, scanRows: 3, bytes: 16384 } };
  const first = await runGraphEvidence(request, { userConfig });
  assert.equal(first.rows.length, 2);
  assert.deepEqual(first.coverage, { scope: 'retained-family', complete: false, upstream: 'not-asserted' });
  const all = [];
  let cursor = null;
  do {
    const page = await runGraphEvidence({ ...request, cursor }, { userConfig });
    assertGraphEvidence('result', page);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= request.limits.bytes);
    all.push(...page.rows); cursor = page.cursor;
  } while (cursor !== null);
  assert.equal(all.length, 9, 'actual canonical producer retains every distinct dynamic occurrence');
  assert.equal(new Set(all.map(row => row.callSiteId)).size, 9);
  const absent = await runGraphEvidence({ ...request, filter: { file: 'absent' }, limits: { rows: 2, scanRows: 1 } }, { userConfig });
  assert.equal(absent.rows.length, 0); assert.ok(absent.cursor, 'empty filtered pages preserve continuation');
  await assert.rejects(runGraphEvidence({ ...request, cursor: first.cursor, filter: { file: 'other' } }, { userConfig }),
    { code: 'ERR_CALL_SITE_CURSOR_SCOPE' });
  for (const invalid of [{ ...request, buildId: '../one' }, { ...request, indexDir: outDir },
    { ...request, filter: { direction: 'out' } }, { ...request, limits: { rows: 0 } },
    { ...request, family: 'graph_relation_edges', filter: { callerChunkUid: 'caller' } }]) {
    await assert.rejects(runGraphEvidence(invalid, { userConfig }), { code: 'ERR_GRAPH_EVIDENCE_CONTRACT' });
  }
  const abort = new AbortController(); abort.abort();
  await assert.rejects(runGraphEvidence(request, { userConfig, signal: abort.signal }), { name: 'AbortError' });
  assert.ok(getToolDefs().find(tool => tool.name === 'graph_evidence'));
  assert.deepEqual(await handleToolCall('graph_evidence', request), first);
  await assert.rejects(handleToolCall('graph_evidence', { ...request, filter: { direction: 'out' } }),
    { code: 'ERR_GRAPH_EVIDENCE_CONTRACT' });
  await assert.rejects(handleToolCall('graph_evidence', { ...request, repoRoot: root }),
    { code: 'ENOENT' }, 'an explicit foreign namespace cannot borrow the retained repository');
  router = createApiRouter({ host: '127.0.0.1', defaultRepo: repoRoot, allowedRepoRoots: [repoRoot] });
  server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = async payload => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/analysis/graph-evidence`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  assert.deepEqual((await post(request)).body.result, first);
  assert.equal((await post({ ...request, repoRoot: root })).status, 403);
  assert.equal((await post({ ...request, filter: { unknown: true } })).status, 400);
  assert.equal((await post({ ...request, cursor: 'wrong' })).status, 400);
  assert.equal((await post({ ...request, buildId: 'missing' })).status, 404);
  await fs.writeFile(path.join(buildsRoot, 'current.json'), JSON.stringify({ buildId: 'newer' }));
  assert.deepEqual((await runGraphEvidence(request, { userConfig })).rows, first.rows,
    'moving current does not redirect an explicitly retained build');
  const file = path.join(root, 'request.json'); await fs.writeFile(file, JSON.stringify(request));
  const { stdout } = await promisify(execFile)(process.execPath,
    ['bin/pairofcleats.js', 'graph-evidence', '--request', file, '--all'], { cwd: process.cwd(), timeout: 10000, maxBuffer: 1048576 });
  const pages = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(pages.flatMap(page => page.rows), all); assert.equal(pages.at(-1).cursor, null);
  const { runGraphEvidenceCli } = await import('../../../tools/analysis/graph-evidence.js');
  const originalOpen = fs.open, opened = new Map(), outputPages = [];
  const firstWrite = Promise.withResolvers(); let releaseFirst;
  const sink = new Writable({ highWaterMark: 1, write(chunk, _encoding, callback) {
    outputPages.push(JSON.parse(chunk.toString('utf8')));
    if (outputPages.length === 1) { releaseFirst = callback; firstWrite.resolve(); }
    else queueMicrotask(callback);
  } });
  fs.open = async (location, ...values) => {
    const normalized = path.resolve(String(location));
    const relative = path.relative(path.toNamespacedPath(outDir), path.toNamespacedPath(normalized));
    if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
      && (normalized.endsWith('.jsonl') || normalized.endsWith('.offsets.bin'))) {
      opened.set(normalized, (opened.get(normalized) || 0) + 1);
    }
    return originalOpen(location, ...values);
  };
  try {
    const streaming = runGraphEvidenceCli(['node', 'graph-evidence', '--request', file, '--all'], { output: sink });
    await firstWrite.promise;
    assert.equal(outputPages.length, 1, 'actual writable backpressure stops page production');
    releaseFirst(); await streaming;
    assert.deepEqual(outputPages.flatMap(page => page.rows), all);
    assert.equal(outputPages.at(-1).done, true);
    assert.ok(opened.size >= 2); assert.ok([...opened.values()].every(count => count === 1), 'CLI all owns one admission per exact piece');
  } finally { fs.open = originalOpen; sink.destroy(); }
  const outputError = Object.freeze(new Error('graph evidence output failed'));
  const failingOutput = new Writable({ write(_chunk, _encoding, callback) { callback(outputError); } });
  await assert.rejects(runGraphEvidenceCli(['node', 'graph-evidence', '--request', file, '--all'], { output: failingOutput }),
    error => error === outputError || error.cause === outputError);
  const closingOutput = new Writable({ highWaterMark: 1, write() { this.destroy(); } });
  await assert.rejects(runGraphEvidenceCli(['node', 'graph-evidence', '--request', file, '--all'], { output: closingOutput }),
    { code: 'ERR_STREAM_DESTROYED' }, 'transport closure cannot leave an enumeration waiting for drain');
  const manifestPath = path.join(outDir, 'pieces', 'manifest.json');
  const original = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const changed = original.fields ? { ...original, fields: { ...original.fields, buildId: 'replacement' } } : { ...original, buildId: 'replacement' };
  await fs.writeFile(manifestPath, JSON.stringify(changed));
  await assert.rejects(runGraphEvidence({ ...request, cursor: first.cursor }, { userConfig }), { code: 'ERR_RETAINED_EVIDENCE_GENERATION' });
  console.log('Retained graph CLI/MCP/HTTP pages preserve generation, cursor, budget and repository authority.');
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (router?.close) await router.close();
  await fs.rm(root, { recursive: true, force: true });
}
