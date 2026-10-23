import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { search as coreSearch } from '../../../src/integrations/core/search.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-prose-scope-')));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
const makeRepo = async (name, modes, compatibilityKey = null) => {
  const repoRoot = path.join(root, name);
  const descriptor = await writeFederationRepoFixture({ repoRoot, cacheRoot: path.join(root, 'cache'), modes });
  for (const mode of modes) {
    const indexDir = await createCompatibilityIndex(descriptor.buildRoot, { mode, compatibilityKey: compatibilityKey || `compat-${mode}`, fileName: 'README.md' });
    const count = mode === 'prose' ? 2 : 20;
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(Array.from({ length: count }, (_, id) => ({
      id, file: 'README.md', name: `${mode}-${id}`, kind: 'Paragraph', start: id, end: id + 1, chunkUid: `${mode}:${id}`
    }))));
  }
  const workspacePath = path.join(root, `${name}-workspace.json`);
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: `./${name}` }] }));
  return { repoRoot, workspacePath };
};
try {
  const missing = await makeRepo('missing', ['prose']);
  const request = { workspacePath: missing.workspacePath, search: { mode: 'prose', ext: 'md', backend: 'memory', top: 1 } };
  const first = await runFederatedSearch(request);
  assert.equal(first.status, 'partial');
  assert.equal(first.partialSuccess, true);
  assert.deepEqual(first.prose.map(hit => hit.name), ['prose-0']);
  assert.equal(first.extractedProse.length, 0);
  assert.ok(first.meta.completeness.unavailable.some(row => row.mode === 'extracted-prose'));
  const last = await runFederatedSearch({ ...request, cursor: first.pagination.nextCursor });
  assert.deepEqual(last.prose.map(hit => hit.name), ['prose-1']);
  assert.equal(last.pagination.hasMore, false);
  await assert.rejects(runFederatedSearch({ ...request, strict: true }), { code: 'NO_INDEX' });
  const ranked = await runFederatedSearch({ workspacePath: missing.workspacePath, query: 'alpha',
    search: { mode: 'prose', backend: 'memory' } });
  assert.equal(ranked.prose.length, 1, 'ranked prose-only plans also avoid unadmitted extracted-prose reads');
  assert.equal(ranked.extractedProse.length, 0);
  assert.equal(ranked.partialSuccess, true);

  const complete = await makeRepo('complete', ['prose', 'extracted-prose']);
  let cursor = null, pages = 0;
  const prose = [], comments = [];
  do {
    const page = await runFederatedSearch({ workspacePath: complete.workspacePath, strict: true,
      cursor, search: { mode: 'prose', ext: 'md', backend: 'memory', top: 2 } });
    pages += 1;
    assert.ok(pages <= 11, 'mode tasks must not page through results they discard');
    assert.equal(page.status, 'ok');
    assert.ok(page.pagination.returned > 0, 'nonempty fixtures cannot produce discarded-mode continuation pages');
    const mode = page.repos[0].mode;
    assert.equal(mode === 'prose' ? page.extractedProse.length : page.prose.length, 0);
    prose.push(...page.prose.map(hit => hit.name));
    comments.push(...page.extractedProse.map(hit => hit.name));
    cursor = page.pagination.nextCursor;
  } while (cursor);
  assert.equal(pages, 11);
  assert.deepEqual(prose, ['prose-0', 'prose-1']);
  assert.equal(new Set(comments).size, 20);
  const ordinaryOptions = { args: ['--mode', 'prose', '--ext', 'md', '--top', '50', '--backend', 'memory', '--json'],
    emitOutput: false, exitOnError: false };
  await assert.rejects(coreSearch(complete.repoRoot, ordinaryOptions), /Incompatible indexes detected/,
    'ordinary multi-mode compatibility checks remain strict');
  const compatible = await makeRepo('compatible', ['prose', 'extracted-prose'], 'compat-shared');
  const ordinary = await coreSearch(compatible.repoRoot, { ...ordinaryOptions,
    emitOutput: false, exitOnError: false });
  assert.equal(ordinary.prose.length, 2);
  assert.equal(ordinary.extractedProse.length, 20, 'ordinary prose mode retains its public comment expansion');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Real federated prose tasks stay within eligible modes, with strict authority and complete bounded pagination.');
