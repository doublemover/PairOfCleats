#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getEnvConfig } from '../../src/shared/env/runtime.js';
import { assertSafeCacheDeletion } from '../../src/shared/cache-deletion.js';
import { getCacheRootBase } from '../../src/shared/cache-roots.js';
import { resolveRepoCacheRootPath, resolvePath } from '../../src/shared/repo-paths.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { cleanupDerivedRepoArtifacts } from '../../src/shared/storage/repo-cleanup.js';
import { withStorageDirectory } from '../../src/shared/storage/directory.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { getCacheRoot, loadUserConfig, resolveRepoConfig } from '../shared/dict-utils.js';

const argv = createCli({ scriptName: 'clean-artifacts', options: {
  all: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
  'allow-unmarked-cache': { type: 'boolean', default: false }, repo: { type: 'string' }
} }).strictOptions().parse();
const { repoRoot: inferredRoot, userConfig: inferredConfig } = resolveRepoConfig(argv.repo);
const root = typeof argv.repo === 'string' && argv.repo.trim() ? path.resolve(argv.repo) : inferredRoot;
const userConfig = argv.repo ? loadUserConfig(root) : inferredConfig;
const env = getEnvConfig();
const cacheRoot = path.resolve(userConfig.cache?.root || env.cacheRoot || getCacheRoot());
// Path selection grants no reader lease and never selects a mutable generation.
const repoCacheRoot = resolveRepoCacheRootPath(root, { ...userConfig, cache: { ...userConfig.cache, root: cacheRoot } });
const reposRoot = path.join(cacheRoot, 'repos');
const authorityRoots = [getCacheRootBase(), getCacheRoot(), env.cacheRoot, cacheRoot].filter(Boolean);
const targets = [];
let enumerationComplete = true;
if (argv.all) {
  let started = false;
  try {
    await withStorageDirectory(reposRoot, async directory => {
      started = true;
      for (let count = 0; ; count++) {
        if (count === 10000) { enumerationComplete = false; break; }
        const entry = await directory.read();
        if (!entry) break;
        targets.push(path.join(reposRoot, entry.name));
      }
    });
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'clean-artifacts-repositories' });
    if (started || diagnostic.code !== 'ENOENT') throw error;
  }
} else targets.push(repoCacheRoot);
const unique = [...new Set(targets)].sort();
// Validate launch authority for the complete bounded selection before mutation.
for (const target of unique) {
  try { await fs.lstat(target); }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'clean-artifacts-selection' }).code === 'ENOENT') continue;
    throw error;
  }
  assertSafeCacheDeletion(target, authorityRoots, {
    allowUnmarked: argv['allow-unmarked-cache'] === true || argv['dry-run'] === true
  });
}
const outcomes = [];
for (const target of unique) {
  const outcome = await cleanupDerivedRepoArtifacts({ repoCacheRoot: target, cacheRoot,
    authorityRoots, dryRun: argv['dry-run'] === true });
  outcomes.push(outcome);
  console.error(`${outcome.status}: ${target}${outcome.reason ? ` (${outcome.reason})` : ''}`);
}
// Configured native stores outside the canonical repo root need their category's
// registered publication/retention owner. A path or marker cannot grant that.
const custom = [];
for (const [category, config, keys] of [
  ['sqlite', userConfig.sqlite, ['dbDir', 'codeDbPath', 'proseDbPath', 'extractedProseDbPath', 'recordsDbPath']],
  ['lmdb', userConfig.lmdb, ['dbDir', 'codeDbPath', 'proseDbPath']]
]) for (const key of keys) {
  if (typeof config?.[key] !== 'string' || !config[key]) continue;
  const target = resolvePath(root, config[key]);
  if (!unique.some(parent => isPathWithinRoot(target, parent))) custom.push({ category, target });
}
const legacy = path.join(root, 'index-sqlite');
try { if ((await fs.lstat(legacy)).isDirectory()) custom.push({ category: 'legacy-sqlite', target: legacy }); }
catch (error) { if (describeStorageFailure(error, { phase: 'clean-artifacts-legacy' }).code !== 'ENOENT') throw error; }
for (const { category, target } of custom) {
  console.error(`retained-protected: ${target} (${category} category cleanup owner required)`);
  outcomes.push({ status: 'retained-protected', root: target, reason: 'backend-category-cleanup-unqualified' });
}
const complete = enumerationComplete && outcomes.every(item => ['removed', 'missing', 'planned'].includes(item.status));
console.error(`\nCleanup ${complete ? 'complete' : 'partial'}: ${outcomes.filter(item => item.removed).length} removed, `
  + `${outcomes.filter(item => item.status === 'retained-protected').length} protected.`);
if (!complete) process.exitCode = 1;
