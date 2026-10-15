import fs from 'node:fs';

/** Resolve only verified platform aliases; leave every other component lexical. */
export const resolveSystemCacheAlias = (resolved, {
  platform = process.platform,
  lstat = fs.lstatSync,
  realpath = fs.realpathSync
} = {}) => {
  if (platform !== 'darwin') return resolved;
  // These root-owned macOS aliases are launch-platform infrastructure, not
  // permission to canonicalize a repository-controlled cache root/descendant.
  for (const [alias, canonical] of [['/var', '/private/var'], ['/tmp', '/private/tmp']]) {
    if (resolved !== alias && !resolved.startsWith(`${alias}/`)) continue;
    try {
      const stat = lstat(alias);
      if (stat.uid === 0 && stat.isSymbolicLink() && realpath(alias) === canonical) {
        return `${canonical}${resolved.slice(alias.length)}`;
      }
    } catch {}
  }
  return resolved;
};
