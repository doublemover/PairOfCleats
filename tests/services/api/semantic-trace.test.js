import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { runSemanticTrace } from '../../../src/integrations/tooling/semantic-trace.js';
import { handleToolCall } from '../../../tools/mcp/tools.js';
import { getToolDefs } from '../../../src/integrations/mcp/defs.js';
import { createApiRouter } from '../../../tools/api/router.js';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-trace-surfaces-'));
const repoRoot = path.join(temp, 'repo');
await fs.mkdir(repoRoot);
await fs.writeFile(path.join(repoRoot, 'input.ts'), 'export function pack() { const a = 1; const b = a + 2; const c = {b}; return c; }');
applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
  indexing: { semantic: { enabled: true, profile: 'rich' }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: false } }
} });
let server, router;
try {
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', 'stub-embeddings': true, 'scm-provider': 'none' });
  const indexDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const { store, manifest } = await openPublishedSemanticStore({ indexDir, repoRoot, requireQueryIndex: true });
  let seed;
  for (const partition of manifest.partitions) for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges')) {
    if (edge.kind === 'defines') { seed ||= edge.from; }
  }
  assert.ok(seed);
  const request = { repoRoot, generation: manifest.generation, seed, direction: 'downstream', limits: { records: 2, edges: 2, depth: 12 } };
  const first = await runSemanticTrace(request);
  assert.ok(first.cursor, 'bounded witness has a continuation');
  assert.ok(getToolDefs().some(tool => tool.name === 'semantic_trace'));
  const mcp = await handleToolCall('semantic_trace', request);
  assert.deepEqual({ ...mcp, cursor: null }, { ...first, cursor: null });
  router = createApiRouter({ host: '127.0.0.1', defaultRepo: repoRoot, allowedRepoRoots: [repoRoot] });
  server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = async payload => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/analysis/semantic-trace', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    return { status: response.status, body: await response.json() };
  };
  const response = await post(request);
  assert.equal(response.status, 200);
  assert.deepEqual({ ...response.body.result, cursor: null }, { ...first, cursor: null });
  assert.equal((await post({ ...request, cursor: 'expired' })).status, 410);
  assert.equal((await post({ ...request, direction: 'callee' })).status, 400);
  assert.equal((await post({ ...request, generation: { ...request.generation, baseBuildId: 'missing' } })).status, 409);
  const requestFile = path.join(temp, 'request.json');
  await fs.writeFile(requestFile, JSON.stringify(request));
  const { stdout } = await promisify(execFile)(process.execPath, ['bin/pairofcleats.js', 'semantic', 'trace', '--request', requestFile, '--all'], {
    cwd: process.cwd(), timeout: 10000, maxBuffer: 1048576
  });
  const pages = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(pages.length > 1);
  assert.equal(pages.at(-1).cursor, null);
  assert.ok(pages.flatMap(page => page.edges).some(edge => edge.kind === 'reads'));
  assert.ok(pages.every(page => page.coverage.analysis.some(row => row.state !== 'complete')), 'partial static analysis remains explicit');
  await assert.rejects(runSemanticTrace({ ...request, direction: 'upstream', cursor: first.cursor }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  const manifestPath = path.join(indexDir, 'semantic_manifest.json');
  const saved = await fs.readFile(manifestPath, 'utf8');
  await fs.writeFile(manifestPath, JSON.stringify({ ...JSON.parse(saved), artifactSurfaceVersion: '0.0.2' }));
  const rejected = await post(request);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.nativeCode, 'ERR_INDEX_FORMAT_UNSUPPORTED');
  await fs.writeFile(manifestPath, saved);
  console.log('semantic trace CLI/MCP/HTTP pinned witness surfaces passed');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  router?.close();
  await fs.rm(temp, { recursive: true, force: true });
}
