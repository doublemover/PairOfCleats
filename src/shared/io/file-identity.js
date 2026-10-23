/** Internal comparison data from an actual opened/path stat, never a deletion
 * capability, registry or portable atomic compare-and-act guarantee. */
export const persistenceFileIdentity = (stat, { multipleLinks = false } = {}) => {
  if (!stat.isFile() || stat.ino === 0n || (multipleLinks ? stat.nlink < 1n : stat.nlink !== 1n)) throw Object.assign(
    new Error('Persistence requires an exact ordinary single-link file.'), { code: 'ERR_PERSISTENCE_FILE_CHANGED' });
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), nlink: String(stat.nlink), size: String(stat.size),
    mtime: String(stat.mtimeNs ?? stat.mtimeMs), ctime: String(stat.ctimeNs ?? stat.ctimeMs), birthtime: String(stat.birthtimeNs ?? stat.birthtimeMs) });
};
export const assertPersistenceFileIdentity = (stat, expected, options) => {
  const actual = persistenceFileIdentity(stat, options);
  if (!expected || Object.keys(actual).some(key => actual[key] !== expected[key])) throw Object.assign(
    new Error('Persistence pathname no longer identifies its sealed original file.'), { code: 'ERR_PERSISTENCE_FILE_CHANGED' });
};
