import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runSearchCli } from '../../../src/retrieval/cli.js';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { createApiRouter } from '../../../tools/api/router.js';
import { buildSearchRequestArgs } from '../../../src/shared/search-request.js';
import { buildMcpSearchArgs } from '../../../tools/mcp/tools/search-args.js';
import { createRequestController } from '../../../src/map/workspace/request.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-public-enumeration-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const indexDir = await createCompatibilityIndex(root, { compatibilityKey: 'public-enumeration', profileId: 'default' });
const chunks = Array.from({ length: 17 }, (_, id) => ({ id, file: 'src/' + id + '.ts', start: 0, end: 1,
  kind: 'FunctionDeclaration', name: 'fn' + id, chunkUid: 'uid:' + id, tokens: ['unused'],
  docmeta: { returns: id % 2 ? 'boolean' : 'number' } }));
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunks));
const router = createApiRouter({ host: '127.0.0.1', defaultRepo: root });
const server = http.createServer(router.handleRequest);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const transport = new StdioClientTransport({ command: process.execPath,
  args: [path.resolve('bin/pairofcleats.js'), 'service', 'mcp', '--repo', root, '--mcp-mode', 'sdk'], stderr: 'pipe' });
const client = new Client({ name: 'public-enumeration', version: '1' });
const input = { repoPath: root, mode: 'code', backend: 'memory', returnType: 'boolean', top: 2 };
const post = async value => {
  const response = await fetch(base + '/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  return { status: response.status, body: await response.json() };
};
const cli = async value => {
  const built = buildSearchRequestArgs(value);
  assert.equal(built.ok, true, built.message);
  return runSearchCli(['--repo', root, '--no-comments', ...built.args, ...(built.query ? ['--', built.query] : [])],
    { emitOutput: false, exitOnError: false });
};
const viewer = createRequestController({ fetchFn: (url, options) => fetch(base + url, options) });
try {
  await client.connect(transport);
  const callers = {
    cli,
    post: async value => { const response = await post(value); assert.equal(response.status, 200); return response.body.result; },
    get: async value => {
      const query = new URLSearchParams(Object.entries(value).filter(([, v]) => v !== undefined));
      const response = await fetch(base + '/search?' + query); assert.equal(response.status, 200);
      return (await response.json()).result;
    },
    mcp: async value => { const response = await client.callTool({ name: 'search', arguments: value });
      assert.equal(response.isError, undefined); return JSON.parse(response.content[0].text); },
    viewer: async value => (await viewer.request('search', value)).result
  };
  for (const [name, call] of Object.entries(callers)) {
    let cursor = null; const ids = [];
    do {
      const result = await call({ ...input, ...(cursor ? { cursor } : {}) });
      assert.equal(result.pagination.total, 8, name);
      assert.ok(result.code.every(hit => hit.scoreType === 'filter'), name);
      ids.push(...result.code.map(hit => hit.id)); cursor = result.pagination.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, [1, 3, 5, 7, 9, 11, 13, 15], name);
  }
  const first = await cli(input);
  for (const [name, call] of Object.entries(callers)) {
    const continued = await call({ ...input, cursor: first.pagination.nextCursor });
    assert.deepEqual(continued.code.map(hit => hit.id), [5, 7], 'CLI cursor through ' + name);
  }
  for (const context of [0, undefined]) assert.equal((await post({ ...input, ...(context === undefined ? {} : { context }) })).status, 200);
  for (const context of [1, -1, 0.5, null, '0']) {
    const response = await post({ ...input, context }); assert.equal(response.status, 400);
    assert.match(JSON.stringify(response.body), /removed|context_pack/);
    assert.throws(() => buildMcpSearchArgs({ ...input, context }), /removed/);
  }
  assert.equal((await post({ mode: 'code', ann: false })).status, 400);
  assert.equal((await post({ ...input, query: 'text', cursor: first.pagination.nextCursor })).status, 400);
  assert.equal((await post({ ...input, asOf: 'build:one', snapshot: 'two' })).status, 400);
  assert.throws(() => buildMcpSearchArgs({ ...input, asOf: 'build:one', snapshot: 'two' }), /combine/);
  assert.equal((await post({ ...input, returnType: 'number', cursor: first.pagination.nextCursor })).status, 400);
  const require = createRequire(import.meta.url);
  const vscode = require('../../../extensions/vscode/search-contract.js');
  parseSearchArgs(vscode.buildSearchArgs('', root, { mode: 'code', type: 'FunctionDeclaration', contextLines: 0 }).slice(1));
  assert.throws(() => vscode.buildSearchArgs('x', root, { contextLines: 1 }), /removed/);
  const python = spawnSync('python3', ['-c',
    'import json,runpy; m=runpy.run_path(' + JSON.stringify(path.resolve('sublime/PairOfCleats/lib/search.py'))
      + '); print(json.dumps(m["build_search_payload"]("", repo_root=' + JSON.stringify(root)
      + ', mode="code", backend="memory", limit=2, ann=False, as_of="latest", advanced={"return_type":"boolean"})))'],
  { encoding: 'utf8', timeout: 5000 });
  assert.equal(python.status, 0, python.stderr);
  const generated = JSON.parse(python.stdout); assert.equal(generated.output, 'compact');
  assert.equal(generated.asOf, 'latest'); assert.equal(generated.returnType, 'boolean'); assert.equal(generated.ann, false);
  assert.equal((await post(generated)).status, 200, 'unchanged Python payload reaches HTTP without fallback');
  const stateFile = path.join(indexDir, 'index_state.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  await fs.writeFile(stateFile, JSON.stringify({ ...state, buildId: 'replaced-build' }));
  assert.equal((await post({ ...input, cursor: first.pagination.nextCursor })).status, 400);
  console.log('CLI/HTTP GET+POST/MCP/viewer enumeration, editor parser/context migration and actual Python payload passed.');
} finally {
  viewer.cancel(); await client.close(); await router.close();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
