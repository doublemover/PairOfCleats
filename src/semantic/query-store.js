import path from 'node:path';
import fs from 'node:fs/promises';
import { openPublishedSemanticStore } from './published-store.js';
import { createSqliteSemanticStore } from './sqlite-store.js';
import { isWithinRoot, toRealPathSync } from '../workspace/identity.js';
import { throwIfAborted } from '../shared/abort.js';
import { completeSemanticReaderCleanup } from './reader-lifetime.js';

/** Explicit immutable backend selection; the query owns and closes its SQLite handle. */
export const openSemanticQueryStore = async options => {
  options = { ...options, ...(options.generation ? { generation: structuredClone(options.generation) } : {}) };
  throwIfAborted(options.signal);
  if (options.backend && !['artifact', 'sqlite'].includes(options.backend)) throw new TypeError('Unknown semantic query backend.');
  const published = await openPublishedSemanticStore(options);
  throwIfAborted(options.signal);
  if (!options.backend || options.backend === 'artifact') return published;
  const buildRoot = toRealPathSync(path.dirname(options.indexDir));
  const filename = path.join(buildRoot,'index-sqlite','index-code.db');
  await fs.access(filename);
  throwIfAborted(options.signal);
  const indexPath = toRealPathSync(filename);
  if (!isWithinRoot(indexPath,buildRoot)) throw Object.assign(new Error('Pinned SQLite database escapes its generation.'),{code:'ERR_SEMANTIC_SCOPE_MISMATCH'});
  const Database = (await import('better-sqlite3')).default;
  throwIfAborted(options.signal);
  const db = new Database(indexPath,{readonly:true,fileMustExist:true});
  const close = db.close.bind(db);
  try {
    db.pragma('query_only = ON');db.pragma('cache_size = -512');
    const store = createSqliteSemanticStore({db,indexPath,repoRoot:options.repoRoot,generation:published.manifest.generation,
      artifactSurfaceVersion:published.manifest.artifactSurfaceVersion,manifest:published.manifest});
    if (store.cursorScope !== published.store.cursorScope) throw Object.assign(new Error('SQLite and retained-source partition inventories differ.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
    store.getSourceSpans = published.store.getSourceSpans;
    throwIfAborted(options.signal);
    return {store,manifest:published.manifest,close};
  } catch(error){await completeSemanticReaderCleanup(close,error,true);throw error;}
};
