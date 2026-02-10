import {
  createRepoCacheManager as createSharedRepoCacheManager,
  normalizeCacheConfig
} from '../../shared/repo-cache-config.js';

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
