import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { parseFederatedCliRequest } from '../../../src/retrieval/federation/args.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-real-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
try {
  for (const name of ['a', 'b']) {
    const repoRoot = path.join(root, name);
    const descriptor = await writeFederationRepoFixture({ repoRoot, cacheRoot: path.join(root, 'cache') });
    const indexDir = await createCompatibilityIndex(descriptor.buildRoot, { compatibilityKey: 'compat-code' });
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([0, 1].map((id) => ({
      id, file: `${name}.js`, name: `${name}${id}`, kind: 'FunctionDeclaration', start: id, end: id + 1, chunkUid: `${name}:${id}`
    }))));
  }
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './a' }, { root: './b' }] }));
  let cursor = null;
  const hits = [];
  for (let i = 0; i < 4; i += 1) {
    const page = await runFederatedSearch({ workspacePath, search: { type: 'FunctionDeclaration', mode: 'code', backend: 'memory', top: 1, cursor } });
    hits.push(...page.code.map((hit) => hit.name));
    cursor = page.pagination.nextCursor;
    assert.equal(page.pagination.hasMore, i < 3);
  }
  assert.deepEqual(hits.sort(), ['a0', 'a1', 'b0', 'b1']);
  const cliRequest = parseFederatedCliRequest(['--workspace', workspacePath, '--mode', 'code',
    '--backend', 'memory', '--type', 'FunctionDeclaration', '--top', '1', '--']);
  const cliFirst = await runFederatedSearch(cliRequest);
  const cliSecond = await runFederatedSearch({ ...cliRequest, cursor: cliFirst.pagination.nextCursor });
  assert.match(cliFirst.code[0].name, /0$/);
  assert.equal(cliSecond.code[0].name, cliFirst.code[0].name.slice(0, -1) + '1',
    'real core search receives the local continuation before the CLI terminator');
  console.log('real federated search exhausts filter matches without ranking');
} finally { await fs.rm(root, { recursive: true, force: true }); }
