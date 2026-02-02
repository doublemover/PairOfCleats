import { configureGitMetaCache } from '../git.js';

export const configureScmMetaCache = ({ provider, cacheConfig, reporter } = {}) => {
  if (provider === 'git') {
    configureGitMetaCache(cacheConfig, reporter);
  }
};
