/** Root comparison data only. This does not make a directory tree immutable or
 * provide a portable atomic compare-and-rename/remove operation. */
export const persistenceDirectoryIdentity = stat => {
  if (!stat.isDirectory() || !['dev', 'ino', 'mode'].every(field => typeof stat[field] === 'bigint') || stat.ino === 0n) throw Object.assign(
    new Error('Directory replacement requires its exact admitted ordinary directory.'), { code: 'ERR_PERSISTENCE_DIRECTORY_CHANGED' });
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode),
    birthtime: String(stat.birthtimeNs ?? stat.birthtimeMs) });
};

export const assertPersistenceDirectoryIdentity = (stat, identity) => {
  const actual = persistenceDirectoryIdentity(stat);
  if (!identity || Object.keys(actual).some(key => actual[key] !== identity[key])) throw Object.assign(
    new Error('Directory pathname no longer identifies its admitted original directory.'), { code: 'ERR_PERSISTENCE_DIRECTORY_CHANGED' });
};
