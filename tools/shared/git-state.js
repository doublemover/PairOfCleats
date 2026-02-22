import simpleGit from 'simple-git';

/**
 * Read lightweight git metadata for a repository.
 * @param {string} repoRoot
 * @param {{includeRemote?:boolean}} [options]
 * @returns {Promise<{head:string|null,dirty:boolean|null,remote:string|null}>}
 */
export async function readRepoGitState(repoRoot, options = {}) {
  const includeRemote = options.includeRemote === true;
  const git = simpleGit({ baseDir: repoRoot });
  try {
    const head = (await git.revparse(['HEAD'])).trim();
    const dirty = !(await git.status()).isClean();
    let remote = null;
    if (includeRemote) {
      const remotes = await git.getRemotes(true);
      const origin = remotes.find((entry) => entry.name === 'origin') || remotes[0];
      remote = origin?.refs?.fetch || null;
    }
    return { head, dirty, remote };
  } catch {
    return { head: null, dirty: null, remote: null };
  }
}
