import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writeFederationRepoFixture } from '../../retrieval/federation/repo-fixture.js';

applyTestEnv();
// Keep HTTP admission, workspace authority, coordinator, generation and cursor
// handling real; replace only retrieval of the already admitted repository page.
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/integrations/core/search.js')) return { format: 'module', shortCircuit: true,
    source: 'export const search = (...args) => globalThis.__filterEnumerationSearch(...args);' };
  return next(url, context);
} });
const { createApiRouter } = await import('../../../tools/api/router.js');
const { runFederatedSearch } = await import('../../../src/retrieval/federation/coordinator.js');
const { parseFederatedCliRequest } = await import('../../../src/retrieval/federation/args.js');
const { runWorkspaceSearch } = await import('../../../tools/mcp/tools/handlers/search.js');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-http-filter-enumeration-'));
let server, router;
try {
  for (const name of ['a', 'b']) await writeFederationRepoFixture({ repoRoot: path.join(root, name), cacheRoot: path.join(root, 'cache') });
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './a' }, { root: './b' }] }));
  let calls = 0;
  globalThis.__filterEnumerationSearch = async (repo, { args }) => {
    calls++;
    assert.ok(args.includes('--type'));
    const continued = args.includes('--cursor');
    return { code: [{ id: continued ? 1 : 0, name: path.basename(repo), scoreType: 'filter' }],
      pagination: { returned: 1, nextCursor: continued ? null : 'local-page-2' } };
  };
  router = createApiRouter({ host: '127.0.0.1', defaultRepo: path.join(root, 'a'), allowedRepoRoots: [root] });
  server = http.createServer(router.handleRequest);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/search/federated`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
    return { status: response.status, body: await response.json() };
  };
  const base = { workspacePath, search: { mode: 'code', type: 'FunctionDeclaration', top: 1 } };
  let cursor = null;
  const seen = [];
  for (let page = 0; page < 4; page++) {
    const request = { ...base, ...(page % 2 ? { query: '' } : {}),
      ...(page === 2 ? { search: { ...base.search, cursor } } : cursor ? { cursor } : {}) };
    const response = await post(request);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const result = response.body;
    assert.equal(result.code.length, 1);
    seen.push(result.code[0].globalId);
    cursor = result.pagination.nextCursor;
    assert.equal(result.pagination.hasMore, page < 3);
    if (page === 0) {
      const changed = await post({ ...base, search: { ...base.search, file: 'other.js' }, cursor });
      assert.equal(changed.status, 400);
      assert.equal(changed.body.code, 'INVALID_REQUEST');
    }
  }
  assert.equal(calls, 4);
  assert.equal(new Set(seen).size, 4);
  for (const invalid of [{ workspacePath }, { workspacePath, query: '', search: {} },
    { workspacePath, search: { top: 1 } }, { ...base, query: 'ranked', cursor: 'invalid' }]) {
    const response = await post(invalid);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_REQUEST');
  }
  const direct = await runFederatedSearch(base);
  const mcp = await runWorkspaceSearch(base);
  const cli = await runFederatedSearch(parseFederatedCliRequest(['--workspace', workspacePath,
    '--type', 'FunctionDeclaration', '--mode', 'code', '--top', '1']));
  assert.equal(direct.code[0].globalId, seen[0], 'shared MCP request shape and HTTP enumerate the same pinned entity');
  assert.equal(mcp.code[0].globalId, seen[0], 'the MCP handler and HTTP enumerate the same pinned entity');
  assert.equal(cli.code[0].globalId, seen[0], 'CLI filter-only enumeration agrees with HTTP');
  const first = await post(base);
  await writeFederationRepoFixture({ repoRoot: path.join(root, 'a'), cacheRoot: path.join(root, 'cache'), buildId: 'changed' });
  assert.equal((await post({ ...base, cursor: first.body.pagination.nextCursor })).status, 400);
} finally {
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  await router?.close();
  hook.deregister();
  delete globalThis.__filterEnumerationSearch;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('HTTP filter-only federation preserves shared enumeration, generation, cursor and invalid-request contracts');
