import {
  createRepoCacheManager as createSharedRepoCacheManager,
  normalizeCacheConfig
} from '../../../src/shared/repo-cache-config.js';

export { normalizeCacheConfig };

export const createRepoCacheManager = ({
  defaultRepo,
  repoCache = {},
  indexCache = {},
  sqliteCache = {}
}) => createSharedRepoCacheManager({
  defaultRepo,
  namespace: 'api',
  repoCache,
  indexCache,
  sqliteCache
});
