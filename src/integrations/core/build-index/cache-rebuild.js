import fs from 'node:fs/promises';
import path from 'node:path';
import { getEnvConfig } from '../../../shared/env/runtime.js';
import { getRepoCacheRoot } from '../../../shared/repo-paths.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { acquireIndexLock } from '../../../index/build/lock.js';

/** Consume destructive launch intent once, before any child handoff. */
export const consumeBuildCacheRebuild = ({ argv, rawArgv = [], env = process.env }) => {
  let explicit = null;
  for (const value of rawArgv) {
    const token = String(value);
    if (token === '--no-cache-rebuild' || token === '--cache-rebuild=false') explicit = false;
    else if (token === '--cache-rebuild' || token === '--cache-rebuild=true') explicit = true;
  }
  const requested = explicit ?? (argv?.['cache-rebuild'] === true || getEnvConfig(env).cacheRebuild);
  delete env.PAIROFCLEATS_CACHE_REBUILD;
  return {
    requested,
    argv: { ...argv, 'cache-rebuild': false },
    rawArgv: rawArgv.filter(value => !/^--(?:no-)?cache-rebuild(?:=|$)/.test(String(value)))
  };
};

/** The repository's existing index lock owns rebuild; global caches are separate. */
export const rebuildRepoCache = async ({ root, userConfig, argv = {}, log = () => {}, abortSignal = null }) => {
  if (argv['index-root'] || ['stage3', 'stage4'].includes(argv.stage)) {
    throw new Error('Cache rebuild requires a new indexing build, without --index-root or stage3/stage4.');
  }
  const repoCacheRoot = path.resolve(getRepoCacheRoot(root, userConfig));
  const repository = await fs.realpath(root);
  if (repoCacheRoot === path.parse(repoCacheRoot).root || repoCacheRoot === repository) {
    throw new Error('Refusing an unsafe repository cache rebuild target.');
  }
  throwIfAborted(abortSignal);
  const lock = await acquireIndexLock({
    repoCacheRoot,
    metadata: { owner: 'build-index', operation: 'cache-rebuild' },
    log
  });
  if (!lock) throw new Error('Index lock unavailable; repository cache rebuild was not performed.');
  try {
    const actualRoot = await fs.realpath(repoCacheRoot);
    const repositoryRelative = path.relative(actualRoot, repository);
    if (actualRoot === path.parse(actualRoot).root
      || (!repositoryRelative.startsWith('..') && !path.isAbsolute(repositoryRelative))) {
      throw new Error('Refusing an unsafe canonical repository cache rebuild target.');
    }
    for (const entry of await fs.readdir(repoCacheRoot, { withFileTypes: true })) {
      throwIfAborted(abortSignal);
      if (entry.name === 'locks') continue;
      await fs.rm(path.join(repoCacheRoot, entry.name), { recursive: true, force: true });
    }
    log(`[cache] rebuilt repository cache: ${repoCacheRoot}`);
    return { repoCacheRoot, rebuilt: true };
  } finally {
    await lock.release();
  }
};
