import { resolveStorageLayout, storagePathApi } from './layout.js';

/** Durable application state is separate from disposable repository cache.
 * repoId must come from the authenticated repo-paths owner, never a display
 * name or an arbitrary saved artifact's model.root. Resolution does not write.
 */
export const resolveRepositoryStateRoot = (repoId, { layout = resolveStorageLayout() } = {}) => {
  if (typeof repoId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,90}$/u.test(repoId)) throw new TypeError('Durable repository state requires a canonical repo ID.');
  const api = storagePathApi(layout.platform);
  const state = layout.descriptors.state;
  const root = api.join(state.path, 'repos', repoId);
  return { ...state, category: 'repo-state', path: root, resolvedPath: root, repoId,
    scope: 'repository', retention: 'durable', rebuildability: 'not-rebuildable',
    ownerIdentity: { ...state.ownerIdentity, repository: repoId }, deletionAuthority: false };
};
