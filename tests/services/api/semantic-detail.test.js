import { formatToolError } from '../../../src/integrations/mcp/protocol.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { getBuildsRoot } from '../../../src/shared/repo-paths.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { runSemanticDetail } from '../../../src/integrations/tooling/semantic-detail.js';
import { handleToolCall } from '../../../tools/mcp/tools.js';
import { getToolDefs } from '../../../src/integrations/mcp/defs.js';
import { createApiRouter } from '../../../tools/api/router.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-surfaces-'));
const repoRoot = path.join(temp, 'repo');
await fs.mkdir(repoRoot);
const input = path.join(repoRoot, 'input.js');
await fs.writeFile(input, 'export function run(input) { return f(1,2,3,4,5,{items:[input,,3]}); }');
applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
  indexing: { semantic: { enabled: true }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: false } }
} });
let server, router;
try {
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', 'stub-embeddings': true, 'scm-provider': 'none' });
  const indexDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const { store, manifest } = await openPublishedSemanticStore({ indexDir, repoRoot, requireQueryIndex: true });
  const syntax = manifest.partitions.find((partition) => partition.partitionId.startsWith('sy1:'));
  let call;
  for await (const row of store.iterateRows(syntax.partitionId, 'semantic_records')) if (row.data.syntacticArgumentCount === 6) call = row;
  const request = { repoRoot, generation: manifest.generation, refs: [{ partitionId: syntax.partitionId, localId: call.id }],
    include: ['operands', 'names', 'ownership'], limits: { records: 1, rows: 2 } };
  const first = await runSemanticDetail(request);
  assert.ok(first.cursor);
  assert.ok(getToolDefs().some((tool) => tool.name === 'semantic_detail' && tool.inputSchema.properties.include));
  const mcp = await handleToolCall('semantic_detail', request);
  assert.deepEqual({ ...mcp, cursor: null }, { ...first, cursor: null });
  const mcpNext = await handleToolCall('semantic_detail', { ...request, cursor: mcp.cursor });
  assert.equal(mcpNext.records.length, 0, 'lossless member continuation does not duplicate the requested node');
  router = createApiRouter({ host: '127.0.0.1', defaultRepo: repoRoot, allowedRepoRoots: [repoRoot] });
  server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/analysis/semantic-detail';
  const post = async (payload) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  const response = await post(request);
  assert.equal(response.status, 200);
  assert.deepEqual({ ...response.body.result, cursor: null }, { ...first, cursor: null });
  const stale = await post({ ...request, generation: { ...request.generation, baseBuildId: 'nonexistent' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.semanticCode, 'ERR_SEMANTIC_GENERATION_MISMATCH');
  assert.equal((await post({ ...request, include: ['trace'] })).status, 400);
  assert.equal((await post({ ...request, cursor: 'expired' })).status, 410);
  const file = path.join(temp, 'request.json');
  await fs.writeFile(file, JSON.stringify(request));
  const { stdout } = await promisify(execFile)(process.execPath, ['bin/pairofcleats.js', 'semantic', 'detail', '--request', file, '--all'], { cwd: process.cwd(), timeout: 10000, maxBuffer: 1048576 });
  const pages = stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(pages.length > 2);
  assert.equal(pages.at(-1).cursor, null);
  assert.equal(pages.flatMap((page) => page.operands).filter((row) => row.slot === 'argument').length, 6);

  // A newer current pointer must not invalidate the retained requested generation.
  await fs.writeFile(input, 'export function changed() { return other(9); }');
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', 'stub-embeddings': true, 'scm-provider': 'none' });
  const currentDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const current = JSON.parse(await fs.readFile(path.join(currentDir, 'semantic_manifest.json'), 'utf8'));
  assert.notEqual(current.generation.baseBuildId, request.generation.baseBuildId);
  assert.ok((await fs.stat(path.join(getBuildsRoot(repoRoot, loadUserConfig(repoRoot)), request.generation.baseBuildId, 'index-code', 'semantic_manifest.json'))).isFile());
  const retained = await runSemanticDetail(request);
  assert.deepEqual({ ...retained, cursor: null }, { ...first, cursor: null });
  const continuation = await post({ ...request, cursor: response.body.result.cursor });
  assert.equal(continuation.status, 200);
  assert.deepEqual(continuation.body.result.generation, request.generation);
  // The outer current manifest gates even when semantic facts are disabled/unavailable.
  const piecePath = path.join(indexDir, 'pieces', 'manifest.json');
  const originalPieces = await fs.readFile(piecePath, 'utf8');
  const pieceManifest = JSON.parse(originalPieces);
  for (const version of [undefined, '0.0.2', '0.1.1']) {
    await fs.writeFile(piecePath, JSON.stringify({ ...pieceManifest, artifactSurfaceVersion: version }));
    const rejected = await post(request);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.nativeCode, 'ERR_INDEX_FORMAT_UNSUPPORTED');
    assert.equal(path.resolve(rejected.body.repoRoot).toLowerCase(), path.resolve(repoRoot).toLowerCase());
    assert.equal(path.resolve(rejected.body.indexPath).toLowerCase(), path.resolve(piecePath).toLowerCase());
    assert.equal(rejected.body.rebuildCommand, 'pairofcleats index build --repo "' + rejected.body.repoRoot + '" --mode all');
    const error = await handleToolCall('semantic_detail', request).then(() => assert.fail('MCP must reject'), error => error);
    const projected = formatToolError(error);
    assert.equal(projected.nativeCode, rejected.body.nativeCode);
    assert.equal(projected.rebuildCommand, rejected.body.rebuildCommand);
    const cli = await promisify(execFile)(process.execPath, ['bin/pairofcleats.js', 'semantic', 'detail', '--request', file], { cwd: process.cwd(), timeout: 10000 }).then(() => assert.fail('CLI must reject'), error => error);
    const diagnostic = JSON.parse(cli.stderr.trim());
    assert.equal(diagnostic.code, rejected.body.nativeCode);
    for (const key of ['operation', 'component', 'expectedVersion', 'foundVersion', 'repoRoot', 'indexPath', 'rebuildCommand']) assert.deepEqual(diagnostic[key], rejected.body[key]);
  }
  await fs.writeFile(piecePath, originalPieces);
  const semanticPath = path.join(indexDir, 'semantic_manifest.json');
  const originalSemantic = await fs.readFile(semanticPath, 'utf8');
  for (const version of [undefined, '0.0.2', '0.1.1']) {
    await fs.writeFile(semanticPath, JSON.stringify({ ...JSON.parse(originalSemantic), artifactSurfaceVersion: version }));
    const rejected = await post(request);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.component, 'semantic manifest');
    assert.equal(path.resolve(rejected.body.indexPath).toLowerCase(), path.resolve(semanticPath).toLowerCase());
  }
  await fs.writeFile(semanticPath, originalSemantic);
  console.log('Semantic detail CLI/MCP/HTTP and retained generation surfaces passed');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  router?.close();
  await fs.rm(temp, { recursive: true, force: true });
}
