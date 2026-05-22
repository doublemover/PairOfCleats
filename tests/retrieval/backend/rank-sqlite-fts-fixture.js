import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';

export const createRankSqliteFtsFixture = async ({
  skipLabel,
  createFts = true,
  rowCount = 20,
  weightForId = () => 1
}) => {
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    console.log(`${skipLabel} skipped: better-sqlite3 not available`);
    process.exit(0);
  }

  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL,
      weight REAL
    );
  `);
  if (createFts) {
    db.exec(`
      CREATE VIRTUAL TABLE chunks_fts
        USING fts5(file, name, signature, kind, headline, doc, tokens, content='');
    `);
  }

  const insertChunk = db.prepare('INSERT INTO chunks (id, mode, weight) VALUES (?, ?, ?)');
  const insertFts = createFts
    ? db.prepare(`
      INSERT INTO chunks_fts (rowid, file, name, signature, kind, headline, doc, tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    : null;
  const seedRows = db.transaction(() => {
    for (let id = 1; id <= rowCount; id += 1) {
      insertChunk.run(id, 'code', weightForId(id));
      insertFts?.run(id, '', '', '', '', '', 'alpha', 'alpha');
    }
  });
  if (rowCount > 0) {
    seedRows();
  }

  const vectorAnnState = {
    code: { available: false },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  };

  const helpers = createSqliteHelpers({
    getDb: (mode) => (mode === 'code' ? db : null),
    postingsConfig: {},
    sqliteFtsWeights: [0, 1, 1, 1, 1, 1, 1, 1],
    maxCandidates: null,
    vectorExtension: {},
    vectorAnnConfigByMode: null,
    vectorAnnState,
    queryVectorAnn: () => [],
    modelIdDefault: 'test-model',
    fileChargramN: 3
  });

  return { db, helpers };
};
