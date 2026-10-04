import path from 'node:path';
import fs from 'node:fs';
import { getDefaultCacheRoot, resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

const physicalPath = (target) => {
  let current = path.resolve(target);
  const suffix = [];
  while (true) {
    try { return path.resolve(fs.realpathSync(current), ...suffix); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
};

/** Resolve shared prerequisites before selecting ephemeral benchmark caches. */
export const resolveBenchmarkResourceRoots = ({
  root, resourceRoot = null, cacheRoot = null, env = process.env, userConfig = null
}) => {
  const config = userConfig || loadUserConfig(root);
  const homeRoot = path.resolve(resourceRoot || env.PAIROFCLEATS_HOME || getDefaultCacheRoot());
  const roots = {
    homeRoot,
    toolingRoot: path.resolve(env.PAIROFCLEATS_TOOLING_DIR || config.tooling?.dir || path.join(homeRoot, 'tooling')),
    dictionaryRoot: path.resolve(env.PAIROFCLEATS_DICT_DIR || config.dictionary?.dir || path.join(homeRoot, 'dictionaries')),
    modelsRoot: path.resolve(env.PAIROFCLEATS_MODELS_DIR || config.models?.dir || path.join(resolveVersionedCacheRoot(homeRoot), 'models')),
    extensionsRoot: path.resolve(env.PAIROFCLEATS_EXTENSIONS_DIR || config.extensions?.dir
      || config.sqlite?.vectorExtension?.dir || path.join(homeRoot, 'extensions'))
  };
  if (cacheRoot) {
    const physicalCache = physicalPath(cacheRoot);
    for (const [name, value] of Object.entries(roots)) {
      if (isPathWithinRoot(value, path.resolve(cacheRoot)) || isPathWithinRoot(physicalPath(value), physicalCache)) {
        throw new Error(`Benchmark ${name} must remain outside the per-run cache. Select a separate --resource-root or explicit asset directory.`);
      }
    }
  }
  return roots;
};

export const applyBenchmarkResourceRoots = (env, roots) => ({
  ...env,
  PAIROFCLEATS_HOME: roots.homeRoot,
  PAIROFCLEATS_TOOLING_DIR: roots.toolingRoot,
  PAIROFCLEATS_DICT_DIR: roots.dictionaryRoot,
  PAIROFCLEATS_MODELS_DIR: roots.modelsRoot,
  PAIROFCLEATS_EXTENSIONS_DIR: roots.extensionsRoot
});
