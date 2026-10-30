import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), versions = new Map();

/** Resolve metadata without importing package code, including packages that do
 * not export package.json. Dependencies are fixed for this process by bootstrap. */
export const installedPackageVersion = name => {
  if (versions.has(name)) return versions.get(name);
  let version = null;
  try {
    let directory = path.dirname(require.resolve(name));
    for (let depth = 0; depth < 16; depth++) {
      try {
        const metadata = require(path.join(directory, 'package.json'));
        if (metadata.name === name && typeof metadata.version === 'string') { version = metadata.version; break; }
      } catch {}
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {}
  versions.set(name, version);
  return version;
};
