import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { buildIndex } from '../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { getBuildsRoot } from '../../src/shared/repo-paths.js';
import { openPublishedSemanticStore } from '../../src/semantic/published-store.js';
import { runSemanticDetail } from '../../src/integrations/tooling/semantic-detail.js';
import { createApiRouter } from '../../tools/api/router.js';
import { applyTestEnv } from './test-env.js';

// Both surface and format cases publish a newer generation while continuing to
// request the original one. A one-build fixture would miss that authority boundary.
export const createSemanticDetailFixture = async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-surfaces-'));
  const repoRoot = path.join(temp, 'repo');
  let server, router;
  const close = async () => {
    try {
      if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } finally {
      router?.close();
      await fs.rm(temp, { recursive: true, force: true });
    }
  };
  try {
    await fs.mkdir(repoRoot);
    const input = path.join(repoRoot, 'input.js');
    await fs.writeFile(input, 'export function run(input) { return f(1,2,3,4,5,{items:[input,,3]}); }');
    applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
      indexing: { workerPool: { enabled: false }, semantic: { enabled: true }, embeddings: { enabled: false },
        typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: false } }
    } });
    const build = () => buildIndex(repoRoot, { mode: 'code', stage: 'stage2', 'stub-embeddings': true, 'scm-provider': 'none' });
    await build();
    const indexDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
    const { store, manifest } = await openPublishedSemanticStore({ indexDir, repoRoot, requireQueryIndex: true });
    const syntax = manifest.partitions.find((partition) => partition.partitionId.startsWith('sy1:'));
    assert.ok(syntax, 'the initial build publishes the syntax partition');
    let call;
    for await (const row of store.iterateRows(syntax.partitionId, 'semantic_records')) {
      if (row.data.syntacticArgumentCount === 6) call = row;
    }
    assert.ok(call, 'the original six-argument call is indexed');
    const request = { repoRoot, generation: manifest.generation, refs: [{ partitionId: syntax.partitionId, localId: call.id }],
      include: ['operands', 'names', 'ownership'], limits: { records: 1, rows: 2 } };
    const first = await runSemanticDetail(request);
    assert.ok(first.cursor);
    const file = path.join(temp, 'request.json');
    await fs.writeFile(file, JSON.stringify(request));
    router = createApiRouter({ host: '127.0.0.1', defaultRepo: repoRoot, allowedRepoRoots: [repoRoot] });
    server = http.createServer((req, res) => router.handleRequest(req, res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/analysis/semantic-detail';
    const post = async (payload) => {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      return { status: response.status, body: await response.json() };
    };
    const publishNewGeneration = async () => {
      await fs.writeFile(input, 'export function changed() { return other(9); }');
      await build();
      const config = loadUserConfig(repoRoot);
      const currentDir = getIndexDir(repoRoot, 'code', config);
      const current = JSON.parse(await fs.readFile(path.join(currentDir, 'semantic_manifest.json'), 'utf8'));
      assert.notEqual(current.generation.baseBuildId, request.generation.baseBuildId);
      assert.ok((await fs.stat(path.join(getBuildsRoot(repoRoot, config), request.generation.baseBuildId, 'index-code', 'semantic_manifest.json'))).isFile());
      const retained = await runSemanticDetail(request);
      assert.deepEqual({ ...retained, cursor: null }, { ...first, cursor: null });
      const continuation = await post({ ...request, cursor: first.cursor });
      assert.equal(continuation.status, 200);
      assert.deepEqual(continuation.body.result.generation, request.generation);
    };
    return { repoRoot, indexDir, request, first, file, post, publishNewGeneration, close };
  } catch (error) {
    await close();
    throw error;
  }
};
