import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { parseFederatedCliRequest } from '../../../src/retrieval/federation/args.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { enumerateWorkspace } from '../../../src/retrieval/federation/enumeration.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-enumerate-'));
try {
  for (const name of ['a', 'b']) await writeFederationRepoFixture({ repoRoot: path.join(root, name), cacheRoot: path.join(root, 'cache') });
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './a' }, { root: './b' }] }));
  const request = parseFederatedCliRequest(['--workspace', workspacePath, '--type', 'FunctionDeclaration', '--mode', 'code', '--top', '1']);
  let calls = 0;
  const searchFn = async (repo, options) => {
    calls += 1;
    const continued = options.args.includes('--cursor');
    return { code: [{ id: continued ? 1 : 0, name: path.basename(repo), scoreType: 'filter' }],
      pagination: { returned: 1, nextCursor: continued ? null : 'local-page-2' } };
  };
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 4; page += 1) {
    const result = await runFederatedSearch({ ...request, cursor }, { searchFn });
    assert.equal(result.code.length, 1);
    seen.push(result.code[0].globalId);
    cursor = result.pagination.nextCursor;
    assert.equal(result.pagination.hasMore, page < 3);
    if (page === 0) {
      await assert.rejects(runFederatedSearch({ ...request, rawArgs: [...request.rawArgs, '--file', 'other.js'], cursor }, { searchFn }), /changed/);
    }
  }
  assert.equal(new Set(seen).size, 4);
  assert.equal(calls, 4);
  await assert.rejects(runFederatedSearch({ ...request, query: 'ranked', cursor: 'cursor' }, { searchFn }), /filter-only/);
  const dates = [];
  const enumeration = {
    tasks: ['a', 'b'].map((repoId) => ({ repo: { repoId, repoRootCanonical: repoId }, mode: 'code' })),
    args: ['--modified-since', '2'], manifestHash: 'generation', verifyGeneration: async () => {},
    search: async (_repo, { args }) => {
      dates.push(args[args.indexOf('--modified-after') + 1]);
      return { code: [], pagination: { nextCursor: null } };
    }
  };
  const dated = await enumerateWorkspace(enumeration);
  assert.equal(dated.pagination.hasMore, true, 'an empty repository page can precede another repository');
  await enumerateWorkspace({ ...enumeration, cursor: dated.pagination.nextCursor });
  assert.equal(dates[0], dates[1], 'relative date cutoff stays fixed across repository pages');
  await assert.rejects(enumerateWorkspace({ ...enumeration,
    verifyGeneration: async () => { throw new Error('generation changed during read'); } }), /generation changed/);
  const first = await runFederatedSearch(request, { searchFn });
  await writeFederationRepoFixture({ repoRoot: path.join(root, 'a'), cacheRoot: path.join(root, 'cache'), buildId: 'changed' });
  await assert.rejects(runFederatedSearch({ ...request, cursor: first.pagination.nextCursor }, { searchFn }), /generation changed/);
  console.log('federated enumeration exhausts repositories and rejects stale or changed cursors');
} finally { await fs.rm(root, { recursive: true, force: true }); }
