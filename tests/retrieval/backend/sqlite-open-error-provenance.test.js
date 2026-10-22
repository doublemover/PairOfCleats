import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const key = Symbol.for('poc.sqlite-open-error');
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'better-sqlite3' ? { url: 'poc:sqlite-open-error', shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url === 'poc:sqlite-open-error' ? { format: 'module', shortCircuit: true,
      source: `export default class Database { constructor(){throw globalThis[Symbol.for('poc.sqlite-open-error')]} }` }
      : nextLoad(url, context);
  }
});
const { dir } = await prepareIsolatedTestCacheDir('sqlite-open-error-provenance');
const warn = console.warn, warnings = [];
console.warn = message => warnings.push(String(message));
try {
  const { createSqliteBackend } = await import('../../../src/retrieval/cli-sqlite.js');
  const dbPath = path.join(dir, 'index.db');
  await fs.writeFile(dbPath, 'ordinary fixture');
  const base = { useSqlite: true, needsCode: true, needsProse: false, needsExtractedProse: false,
    sqliteCodePath: dbPath, vectorExtension: {}, vectorAnnEnabled: false, backendForcedSqlite: true };
  for (const code of ['EACCES', 'SQLITE_NOTADB', 'SQLITE_CANTOPEN']) {
    const cause = Object.assign(new Error(`controlled ${code}`), { code });
    globalThis[key] = cause;
    await assert.rejects(createSqliteBackend(base), error => error.code === code && error.cause === cause
      && error.message.includes(dbPath) && !error.message.includes('is missing'));
    const fallback = await createSqliteBackend({ ...base, backendForcedSqlite: false });
    assert.equal(fallback.useSqlite, false);
    assert.match(warnings.pop(), new RegExp(code));
  }
  await fs.rm(dbPath);
  await assert.rejects(createSqliteBackend(base), error => error.code === 'ENOENT'
    && error.message.includes('may be empty or not built') && error.message.includes('stage4'));
  assert.deepEqual(warnings, []);
} finally {
  console.warn = warn; hooks.deregister(); delete globalThis[key];
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('SQLite open failures retain the actual mode, path and original failure cause.');
