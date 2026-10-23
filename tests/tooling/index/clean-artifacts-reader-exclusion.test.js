import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanArtifacts } from '../../../tools/mcp/tools/handlers/artifacts.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { acquireRepoCacheAccessLease } from '../../../src/shared/cache/repo-access.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const temporary = await makeTempDir('clean-artifacts-reader-');
const repo = path.join(temporary, 'repo'), cacheRoot = path.join(temporary, 'cache');
await fs.mkdir(repo, { recursive: true }); await fs.mkdir(cacheRoot);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ cache: { root: cacheRoot } }));
await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
const selected = resolveRepoCacheRootPath(repo, { cache: { root: cacheRoot } });
const sentinel = path.join(selected, 'tree-sitter-chunk-cache', `tree-sitter-chunk_lk1_${'a'.repeat(40)}.json`);
await fs.mkdir(path.dirname(sentinel), { recursive: true });
const bytes = JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks'));
await fs.writeFile(sentinel, bytes);
const originalTrusted = process.env.PAIROFCLEATS_TRUSTED_CONFIG;
const env = applyTestEnv({ syncProcess: true, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
let reader = acquireRepoCacheAccessLease(selected);
const cli = extra => runNode([path.resolve('tools/index/clean-artifacts.js'), '--repo', repo, ...extra],
  'clean-artifacts actual reader admission', process.cwd(), env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
try {
  const blocked = cli([]);
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.match(blocked.stderr, /retained-protected/);
  assert.match(blocked.stderr, /Cleanup partial/);
  await assert.rejects(cleanArtifacts({ repoPath: repo }), /retained-protected|Cleanup partial/);
  await assert.rejects(cleanArtifacts({ repoPath: repo, all: true }), /all repository caches/);
  assert.equal(await fs.readFile(sentinel, 'utf8'), bytes, 'CLI and MCP leave lazy reader input available');
  assert.equal(reader.release(), true); reader = null;
  const preview = cli(['--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(await fs.readFile(sentinel, 'utf8'), bytes);
  const removed = cli([]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stderr, /removed:/);
  await assert.rejects(fs.stat(selected), { code: 'ENOENT' });
} finally {
  reader?.release();
  if (originalTrusted === undefined) delete process.env.PAIROFCLEATS_TRUSTED_CONFIG;
  else process.env.PAIROFCLEATS_TRUSTED_CONFIG = originalTrusted;
  await rmDirRecursive(temporary);
}
console.log('Actual cleanup CLI/MCP honor original reader exclusion and qualified dry-run/removal.');
