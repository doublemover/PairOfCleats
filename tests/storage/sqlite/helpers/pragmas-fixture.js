import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

export const loadSqlitePragmaDatabase = async () => {
  try {
    const loaded = await import('better-sqlite3');
    return loaded.default;
  } catch (err) {
    console.error(`better-sqlite3 missing: ${err?.message || err}`);
    process.exit(1);
  }
};

export const preparePragmaTestRoot = async (label) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, label);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  return tempRoot;
};

export const readPragmaValue = (db, name) => {
  try {
    return db.pragma(name, { simple: true });
  } catch {
    return null;
  }
};

export const openPragmaTestDatabase = async ({ label, name, Database }) => {
  const tempRoot = await preparePragmaTestRoot(label);
  const dbPath = path.join(tempRoot, name);
  return {
    tempRoot,
    dbPath,
    db: new Database(dbPath)
  };
};
