#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-map-cache-isolation-')));
const repo = path.join(temp, 'repo');
await fs.mkdir(path.join(repo, 'src'), { recursive: true });
await fs.writeFile(path.join(repo, 'src/cache.js'), 'export function refreshCache(value) { return value; }\n');
const env = applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'off', testConfig: {
  indexing: { scm: { provider: 'none' }, workerPool: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false,
    riskAnalysisCrossFile: false, embeddings: { enabled: false, mode: 'off' } },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
} });
const cli = (args) => {
  const result = runNode([path.join(root, 'bin', 'pairofcleats.js'), ...args], args.join(' '), repo, env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(result.status, 0, `${result.error?.code || ''} ${result.signal || ''}\n${result.stderr}`);
  return result;
};
const build = () => {
  const result = cli(['index', 'build', '--repo', repo, '--stage', 'stage1', '--mode', 'code', '--threads', '1']);
  assert.doesNotMatch(result.stderr, /Worker pool enabled/, 'the fixture explicitly disables worker pools');
  return result;
};
const stats = () => JSON.parse(cli(['index', 'stats', '--repo', repo, '--mode', 'code', '--json']).stdout);
const map = (extra = []) => JSON.parse(cli(['report', 'map', '--repo', repo, '--format', 'json', ...extra]).stdout);

try {
  build();
  const before = stats();
  const firstMap = map();
  assert.ok(firstMap.nodes.length > 0);
  await assert.rejects(fs.access(path.join(repo, '.pairofcleats')), 'default map cache must stay outside the source repo');
  const cacheDir = path.join(getRepoCacheRoot(repo, loadUserConfig(repo)), 'maps', 'cache');
  const cacheFiles = await fs.readdir(cacheDir);
  assert.equal(cacheFiles.length, 1);
  assert.match(cacheFiles[0], /^poc-code-map-cache-v1-[a-f0-9]{64}\.json$/, 'cache filename must be portable to Windows');
  assert.ok(map().nodes.length > 0, 'warm cache must remain readable');

  const explicit = path.join(repo, 'custom-cache');
  map(['--cache-dir', explicit, '--refresh']);
  assert.equal((await fs.readdir(explicit)).length, 1, 'explicit cache destination remains supported');
  const [explicitCacheName] = await fs.readdir(explicit);
  await fs.copyFile(path.join(explicit, explicitCacheName), path.join(repo, 'renamed-map-data.json'));

  const legacyCache = path.join(repo, '.pairofcleats', 'maps', 'cache');
  await fs.mkdir(legacyCache, { recursive: true });
  if (process.platform !== 'win32') {
    await fs.writeFile(path.join(legacyCache, `code-map:lk1:${'a'.repeat(40)}.json`), JSON.stringify(firstMap, null, 2));
  }
  build();
  assert.equal(stats().modes.code.chunkMeta.rows, before.modes.code.chunkMeta.rows,
    'build-map-rebuild must not ingest current, renamed or legacy map cache data');
  await fs.writeFile(path.join(explicit, 'authored.js'), 'export const intentionallySearchable = 1;\n');
  await fs.writeFile(path.join(legacyCache, 'authored.js'), 'export const legacySibling = 2;\n');
  build();
  assert.equal(stats().modes.code.chunkMeta.rows, before.modes.code.chunkMeta.rows + 2,
    'authored source siblings in default and explicit cache directories must remain searchable');
  console.log('Map caches stay external, have portable names, and do not feed the next index build.');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
