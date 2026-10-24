import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApiRouter } from '../../../tools/api/router.js';
import { createFederatedSearchValidator } from '../../../tools/api/validation.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { parseFederatedCliRequest } from '../../../src/retrieval/federation/args.js';
import { runWorkspaceSearch } from '../../../tools/mcp/tools/handlers/search.js';
import { writeFederationRepoFixture } from '../../retrieval/federation/repo-fixture.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-http-core-policy-'));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot, embeddings: 'off' });
let server;
let router;
try {
  for (const [name, modes, compatibilityKey] of [
    ['healthy', ['code', 'prose', 'extracted-prose'], 'compatible'],
    ['missing', ['prose'], 'compatible'],
    ['other', ['code'], 'other-cohort']
  ]) {
    const descriptor = await writeFederationRepoFixture({ repoRoot: path.join(root, name), cacheRoot, modes });
    for (const mode of modes) {
      const indexDir = await createCompatibilityIndex(descriptor.buildRoot, { mode, compatibilityKey });
      await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([0, 1].map(id => ({
        id, chunkUid: `${name}:${mode}:${id}`, file: 'duplicate.js', name: `${name}-${id}`,
        kind: 'FunctionDeclaration', start: id, end: id + 1, tokens: ['alpha'], text: 'alpha'
      }))));
    }
  }
  const workspace = async (name, repos) => {
    const file = path.join(root, `${name}.json`);
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos }));
    return file;
  };
  const healthyPath = await workspace('healthy-workspace', [{ root: './healthy', alias: 'healthy' }]);
  const missingPath = await workspace('missing-workspace', [{ root: './healthy' }, { root: './missing' }]);
  const allMissingPath = await workspace('all-missing-workspace', [{ root: './missing' }]);
  const disabledPath = await workspace('disabled-workspace', [
    { root: './healthy', alias: 'healthy' }, { root: './missing', alias: 'disabled', enabled: false }
  ]);
  const cohortsPath = await workspace('cohorts-workspace', [{ root: './healthy', priority: 10 }, { root: './other', priority: 1 }]);
  router = createApiRouter({ host: '127.0.0.1', defaultRepo: path.join(root, 'healthy'), allowedRepoRoots: [root] });
  server = http.createServer(router.handleRequest);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/search/federated`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000)
    });
    return { status: response.status, body: await response.json() };
  };
  const ranked = { workspacePath: healthyPath, query: 'alpha', strict: true, search: { mode: 'code', backend: 'memory', top: 2 } };
  const cold = await post(ranked);
  assert.equal(cold.status, 200, JSON.stringify(cold.body));
  assert.equal(cold.body.status, 'complete');
  assert.equal(cold.body.partialSuccess, false);
  assert.equal(cold.body.meta.policy.acceptPartialResults, false);
  assert.deepEqual((await post(ranked)).body, cold.body, 'warm transport results retain cold provenance and policy');
  const empty = await post({ ...ranked, query: 'absent-token' });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.status, 'empty');
  assert.equal(empty.body.partialSuccess, false);

  for (const shape of ['ranked', 'enumeration']) {
    const request = { ...ranked, ...(shape === 'enumeration' ? { query: '', search: { ...ranked.search, type: 'FunctionDeclaration' } } : {}) };
    for (const workspacePath of [missingPath, allMissingPath]) {
      const strict = await post({ ...request, workspacePath });
      assert.equal(strict.status, 409, JSON.stringify(strict.body));
      assert.equal(strict.body.code, 'NO_INDEX');
    }
    const partial = await post({ ...request, workspacePath: missingPath, strict: false });
    assert.equal(partial.status, 200, JSON.stringify(partial.body));
    assert.equal(partial.body.partialSuccess, true);
    const disabled = await post({ ...request, workspacePath: disabledPath });
    assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
    assert.equal(disabled.body.partialSuccess, false, 'disabled members omitted by selection are outside strict scope');
    const explicitlyIncluded = await post({ ...request, workspacePath: disabledPath, select: { repos: ['disabled'] } });
    assert.equal(explicitlyIncluded.status, 409, 'an explicitly selected disabled member is requested work');
  }
  const missingMode = await post({ ...ranked, workspacePath: allMissingPath, search: { mode: 'prose', backend: 'memory' } });
  assert.equal(missingMode.status, 409, 'prose request includes unavailable extracted prose');

  for (const cohort of [undefined, ['other-cohort']]) {
    const response = await post({ ...ranked, workspacePath: cohortsPath, ...(cohort ? { cohort } : {}) });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.partialSuccess, false, 'intentional cohort exclusion does not contradict strict completeness');
    assert.equal(response.body.meta.policy.responseStatus, 'complete');
    assert.equal(response.body.meta.cohorts.excluded.code.length, 1);
  }
  const incompatible = await post({ ...ranked, workspacePath: cohortsPath, cohorts: { policy: 'strict' } });
  assert.equal(incompatible.status, 400, 'cohort compatibility policy remains distinct from execution strictness');

  const enumeration = { workspacePath: healthyPath, strict: true,
    search: { mode: 'code', backend: 'memory', type: 'FunctionDeclaration', top: 1 } };
  const first = await post(enumeration);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const cursor = first.body.pagination.nextCursor;
  const second = await post({ ...enumeration, query: '', search: { ...enumeration.search, cursor } });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.pagination.hasMore, false);
  assert.notEqual(first.body.code[0].chunkUid, second.body.code[0].chunkUid);
  const sameAliases = await post({ ...enumeration, cursor, search: { ...enumeration.search, cursor } });
  assert.equal(sameAliases.status, 200);
  assert.deepEqual(sameAliases.body.code.map(hit => hit.chunkUid), second.body.code.map(hit => hit.chunkUid));
  assert.equal(sameAliases.body.pagination.nextCursor, second.body.pagination.nextCursor);
  const cli = await runFederatedSearch(parseFederatedCliRequest(['--workspace', healthyPath, '--mode', 'code',
    '--backend', 'memory', '--type', 'FunctionDeclaration', '--top', '1', '--']));
  const mcp = await runWorkspaceSearch(enumeration);
  assert.equal(cli.code[0].chunkUid, first.body.code[0].chunkUid);
  assert.equal(mcp.code[0].chunkUid, first.body.code[0].chunkUid);

  const invalid = [
    { workspacePath: healthyPath }, { ...enumeration, search: { top: 1 } },
    { ...enumeration, query: 'alpha', cursor }, { ...enumeration, cursor, search: { ...enumeration.search, cursor: 'different' } },
    { ...enumeration, search: { type: {} } }, { ...enumeration, search: { unexpectedFilter: true } },
    { ...enumeration, search: { context: 1, type: 'FunctionDeclaration' } },
    { ...enumeration, search: { asOf: 'build:one', snapshot: 'two', type: 'FunctionDeclaration' } },
    { ...enumeration, search: { query: 'nested-query' } }, { ...enumeration, cursor: 'x'.repeat(16385) }
  ];
  const validate = createFederatedSearchValidator();
  for (const request of invalid) {
    assert.equal(validate(request).ok, false);
    const response = await post(request);
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.code, 'INVALID_REQUEST');
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runWorkspaceSearch(enumeration, { signal: controller.signal }), { code: 'CANCELLED' });
  await assert.rejects(runFederatedSearch(ranked, { signal: controller.signal }), { code: 'CANCELLED' });
} finally {
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  await router?.close();
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Real federation HTTP/core/CLI/MCP consumers agree on query/filter admission, strict scope, cohorts, and continuation.');
