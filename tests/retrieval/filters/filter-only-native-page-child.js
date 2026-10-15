import Database from 'better-sqlite3';
import { open } from 'lmdb';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { createLmdbHelpers } from '../../../src/retrieval/lmdb-helpers.js';
import { createIndexBackendLoader } from '../../../src/retrieval/cli/load-indexes/backend.js';
import { createFilterEnumeration, enumerateFilterMatches, buildFilterPagination } from '../../../src/retrieval/pipeline/filter-enumeration.js';
import { LMDB_ARTIFACT_KEYS } from '../../../src/storage/lmdb/schema.js';
import { decodeLmdbValue } from '../../../src/storage/lmdb/utils.js';
const { backend, location, cacheDir, cursor = null } = JSON.parse(process.argv[2]);
const db = backend === 'sqlite' ? new Database(location)
  : backend === 'lmdb' ? open({ path: location, encoding: 'binary', readOnly: true }) : null;
try {
  const filters = { type: 'FunctionDeclaration' };
  const enumeration = createFilterEnumeration({ cursor, cacheDir, filters, modes: ['code'], generation: { id: 'native-' + backend } });
  const sqlite = backend === 'sqlite' ? createSqliteHelpers({ getDb: () => db, postingsConfig: {} }) : null;
  const lmdb = backend === 'lmdb' ? createLmdbHelpers({ getDb: () => db, hnswConfig: {} }) : null;
  const loader = createIndexBackendLoader({ rootDir: cacheDir, userConfig: {}, filterOnly: true, filterEnumeration: enumeration,
    filterTopN: 997, annActive: false, requiredArtifacts: new Set(), hnswConfig: {},
    loadIndexFromSqlite: sqlite?.loadIndexFromSqlite, loadIndexFromLmdb: lmdb?.loadIndexFromLmdb });
  const idx = await loader.loadModeIndex({ mode: 'code', run: true, backend, dir: location });
  if (backend === 'lmdb' && !idx.preparedFilterPage && idx.chunkMeta[0]?.kind !== 'FunctionDeclaration') {
    const raw = db.get(LMDB_ARTIFACT_KEYS.chunkMeta), decoded = decodeLmdbValue(raw);
    throw new Error('Native fixture LMDB metadata empty: ' + JSON.stringify({ keys: [...db.getKeys()].slice(0, 8),
      rawLength: raw?.length, decodedLength: decoded?.length, firstKind: decoded?.[0]?.kind,
      retainedSlots: idx.chunkMeta.length, retainedKind: idx.chunkMeta[0]?.kind, isArray: Array.isArray(idx.chunkMeta), first: idx.chunkMeta[0] }));
  }
  const code = await enumerateFilterMatches({ meta: idx.chunkMeta, mode: 'code', topN: 997, enumeration,
    match: row => row.kind === filters.type, loadCost: idx.filterLoadCost, preparedPage: idx.preparedFilterPage, ensureMetadata: idx.loadFilterMetadata });
  console.log(JSON.stringify({ ids: code.map(row => row.id), pagination: buildFilterPagination(enumeration, { code }) }));
} finally { await db?.close(); }
