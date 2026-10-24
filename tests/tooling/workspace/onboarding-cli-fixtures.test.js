#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { writeFederationRepoFixture } from '../../retrieval/federation/repo-fixture.js';

// Real canonical CLI/read/search consumers over authored artifacts. This does
// not qualify the index producer; it exercises the onboarding bridge itself.
const checkout = process.cwd();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-workspace-onboarding-'));
const workspacePath = path.join(root, 'workspace with spaces.jsonc');
const repos = ['alpha', 'beta'].map(alias => ({ alias, root: path.join(root, `${alias} project`) }));
const cacheRoot = path.join(root, 'cache');
const env = applyTestEnv({ cacheRoot, embeddings: 'off' });
const run = (args, allowFailure = false) => runNode([path.join(checkout, 'bin/pairofcleats.js'), ...args],
  'workspace onboarding CLI fixtures', checkout, env, { stdio: 'pipe', timeoutMs: 5000, allowFailure });
const json = args => JSON.parse(run([...args, '--json']).stdout);
try {
  for (const repo of repos) await fs.mkdir(repo.root);
  const init = ['workspace', 'init', '--workspace', workspacePath,
    ...repos.flatMap(repo => ['--repo', repo.root]), ...repos.flatMap(repo => ['--alias', repo.alias])];
  const preview = json(init);
  assert.equal(preview.repos.length, 2);
  assert.deepEqual(preview.repos.map(repo => repo.alias), ['alpha', 'beta']);
  await assert.rejects(fs.stat(workspacePath), { code: 'ENOENT' });
  for (const repo of repos) assert.deepEqual(await fs.readdir(repo.root), []);
  assert.equal(json([...init, '--apply']).ok, true);
  const configBytes = await fs.readFile(workspacePath);
  const overwrite = run([...init, '--apply', '--json'], true);
  assert.equal(overwrite.status, 1);
  assert.equal(JSON.parse(overwrite.stdout).state, 'blocked');
  assert.deepEqual(await fs.readFile(workspacePath), configBytes);
  assert.equal(json(['workspace', 'validate', '--workspace', workspacePath]).ok, true);
  const missing = json(['workspace', 'status', '--workspace', workspacePath]);
  assert.equal(missing.modes.code.state, 'incomplete');
  assert.equal(missing.modes.code.missing, 2);
  assert.equal(missing.nextActions.filter(action => action.mode === 'code' && action.command).length, 2);
  assert.deepEqual(await fs.readFile(workspacePath), configBytes);
  await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });

  for (const repo of repos) {
    const descriptor = await writeFederationRepoFixture({ repoRoot: repo.root, cacheRoot });
    const indexDir = await createCompatibilityIndex(descriptor.buildRoot, { compatibilityKey: 'compat-code' });
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([{
      id: 0, file: `${repo.alias}.js`, name: `${repo.alias}Symbol`, kind: 'FunctionDeclaration',
      start: 1, end: 2, chunkUid: `${repo.alias}:symbol`
    }]));
  }
  const ready = json(['workspace', 'status', '--workspace', workspacePath]);
  assert.equal(ready.modes.code.state, 'ready');
  assert.equal(ready.nextActions.filter(action => action.mode === 'code' && action.command).length, 0);
  const catalog = json(['workspace', 'catalog', '--workspace', workspacePath]);
  assert.deepEqual(catalog.modes, ready.modes);
  assert.deepEqual(catalog.nextActions, ready.nextActions);
  const searchArgs = ['search', '--workspace', workspacePath, '--mode', 'code', '--backend', 'memory',
    '--type', 'FunctionDeclaration', '--top', '5'];
  const hits = json(searchArgs).code;
  assert.deepEqual(hits.map(hit => hit.repoAlias).sort(), ['alpha', 'beta']);
  for (const hit of hits) { assert.ok(hit.repoId); assert.ok(hit.globalId); }
  const member = ready.nextCommands.members.find(repo => repo.alias === 'alpha');
  const filtered = json([...searchArgs, '--repo-filter', member.repoId]).code;
  assert.deepEqual(filtered.map(hit => hit.repoAlias), ['alpha']);
  assert.deepEqual(await fs.readFile(workspacePath), configBytes);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Canonical workspace onboarding reaches correctly attributed fixture search results.');
