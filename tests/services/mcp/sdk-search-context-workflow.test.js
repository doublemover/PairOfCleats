import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIndex } from '../../../src/integrations/core/build-index.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-mcp-workflow-'));
const repo = path.join(root, 'repo');
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off', testConfig: {
  indexing: { scm: { provider: 'none' }, workerPool: { enabled: false }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }, sqlite: { use: false }
} });
const client = new Client({ name: 'search-context-workflow', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [path.resolve('bin/pairofcleats.js'), 'service', 'mcp', '--mcp-mode', 'sdk'],
  env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')), stderr: 'pipe' });
const calls = [];
let pid;
try {
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, 'math.js'), 'export function sum(left, right) { return left + right; }\n');
  await fs.writeFile(path.join(repo, 'api.js'), "import { sum } from './math.js';\nexport function total() { return sum(1, 2); }\n");
  await fs.writeFile(path.join(repo, 'math.test.js'), "import { sum } from './math.js';\nconsole.assert(sum(1, 2) === 3);\n");
  await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, log: () => {} });
  await client.connect(transport);
  pid = transport.pid;
  const tools = (await client.listTools()).tools;
  assert.ok(tools.some((tool) => tool.name === 'search'));
  assert.ok(tools.some((tool) => tool.name === 'context_pack'));
  const call = async (name, args) => {
    const started = performance.now();
    const result = await client.callTool({ name, arguments: { repoPath: repo, ...args } });
    calls.push({ name, elapsedMs: Math.round(performance.now() - started), bytes: Buffer.byteLength(JSON.stringify(result)) });
    return { result, payload: JSON.parse(result.content[0].text) };
  };
  for (let i = 0; i < 6; i += 1) {
    const { result, payload } = await call('search', { query: 'sum', mode: 'code', backend: 'memory', top: 3 });
    assert.ok(!result.isError, JSON.stringify(payload));
    assert.ok(payload.code.some((hit) => hit.file === 'math.js'));
    assert.equal(payload.code[0].file, 'math.js', 'exact definition outranks callers and tests');
    assert.ok(calls.at(-1).bytes < 64 * 1024, 'compact search response stays bounded');
  }
  const context = await call('context_pack', { seed: 'file:math.js', hops: 1, includeGraph: true,
    includeRisk: false, includeSemantic: false, maxBytes: 512, maxNodes: 12, maxEdges: 24 });
  assert.ok(!context.result.isError, JSON.stringify(context.payload));
  assert.match(JSON.stringify(context.payload), /return left \+ right/);
  assert.ok(calls.at(-1).bytes < 128 * 1024);
  const invalid = await call('context_pack', { seed: 'malformed', hops: 0 });
  assert.equal(invalid.result.isError, true);
  const recovered = await call('search', { query: 'total', mode: 'code', backend: 'memory' });
  assert.ok(!recovered.result.isError);
  assert.ok(recovered.payload.code.length);
  console.log(JSON.stringify({ protocol: 'SDK stdio', calls, serverPid: pid }));
} finally {
  await client.close();
  if (pid) assert.throws(() => process.kill(pid, 0), /ESRCH/, 'server exits after client closes');
  await fs.rm(root, { recursive: true, force: true });
}
