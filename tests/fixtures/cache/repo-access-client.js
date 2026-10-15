import { retainCachePathAccess, withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';
import path from 'node:path';
import fs from 'node:fs';
import { getRepoCacheRoot } from '../../../src/shared/repo-paths.js';

process.on('message', () => process.exit(0));
try {
  if (process.argv[5] === 'cleanup') {
    await withExclusiveRepoCacheCleanup(process.argv[4], async () => {
      process.send({ locked: true });
      await new Promise(() => {});
    });
  } else {
    const root = process.argv[4] ? (retainCachePathAccess(process.argv[4]), path.resolve(process.argv[4], '../../..')) : getRepoCacheRoot(process.argv[2], { cache: { root: process.argv[3] } });
    process.send({ root, readable: fs.existsSync(root) });
  }
} catch (error) {
  process.send({ code: error.code, message: error.message });
}
