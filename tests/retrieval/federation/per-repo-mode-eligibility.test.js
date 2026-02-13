#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { parseFederatedCliRequest } from '../../../src/retrieval/federation/args.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-per-repo-mode-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoCode = path.join(tempRoot, 'repo-code');
const repoProse = path.join(tempRoot, 'repo-prose');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

const writeRepo = async (repoRoot, modes) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
  const repoCacheRoot = getRepoCacheRoot(repoRoot);
  const buildRoot = path.join(repoCacheRoot, 'builds', 'test-build');
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
    buildId: 'test-build',
    buildRoot,
    modes
  }, null, 2), 'utf8');
  for (const mode of modes) {
    const indexDir = path.join(buildRoot, `index-${mode}`);
    await fs.mkdir(indexDir, { recursive: true });
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
    await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
    await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
      compatibilityKey: `compat-${mode}`
    }, null, 2), 'utf8');
  }
};

await writeRepo(repoCode, ['code']);
await writeRepo(repoProse, ['prose']);

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-code", "alias": "code-only", "priority": 10 },
    { "root": "./repo-prose", "alias": "prose-only", "priority": 5 }
  ]
}`, 'utf8');

const queryToken = 'federated-per-repo-mode';
const request = parseFederatedCliRequest([
  queryToken,
  '--workspace',
  workspacePath,
  '--mode',
  'both',
  '--top',
  '5'
]);

const searchCalls = [];
const getModeFromArgs = (args = []) => {
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '');
    if (token === '--mode') {
      return String(args[i + 1] || '').trim().toLowerCase();
    }
    if (token.startsWith('--mode=')) {
      return token.slice('--mode='.length).trim().toLowerCase();
    }
  }
  return '';
};

const response = await runFederatedSearch(request, {
  searchFn: async (repoRootCanonical, params) => {
    const leaf = path.basename(repoRootCanonical);
    const mode = getModeFromArgs(params?.args);
    searchCalls.push({ leaf, mode });
    if (leaf === 'repo-code') {
      if (mode !== 'code') throw createError(ERROR_CODES.NO_INDEX, `repo-code only supports code, got ${mode || 'default'}`);
      return {
        backend: 'memory',
        code: [{ id: 'code-hit', file: 'src/code.js', start: 1, end: 1, score: 1 }],
        prose: [],
        extractedProse: [],
        records: []
      };
    }
    if (leaf === 'repo-prose') {
      if (mode !== 'prose') throw createError(ERROR_CODES.NO_INDEX, `repo-prose only supports prose, got ${mode || 'default'}`);
      return {
        backend: 'memory',
        code: [],
        prose: [{ id: 'prose-hit', file: 'docs/prose.md', start: 1, end: 1, score: 1 }],
        extractedProse: [],
        records: []
      };
    }
    throw createError(ERROR_CODES.INTERNAL, `unexpected repo ${leaf}`);
  }
});

assert.equal(response.ok, true);
assert.equal(response.code.length, 1, 'code-only repo should still contribute code hits');
assert.equal(response.prose.length, 1, 'prose-only repo should still contribute prose hits');
assert.equal(response.extractedProse.length, 0, 'no repo provides extracted-prose in this fixture');

const callsByRepo = new Map(searchCalls.map((entry) => [entry.leaf, entry.mode]));
assert.equal(callsByRepo.get('repo-code'), 'code', 'repo-code fanout should use --mode code');
assert.equal(callsByRepo.get('repo-prose'), 'prose', 'repo-prose fanout should use --mode prose');

console.log('federated per-repo mode eligibility test passed');
