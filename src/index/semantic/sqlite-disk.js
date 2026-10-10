import fs from 'node:fs';

const size = filename => {
  try { return fs.statSync(filename).size; } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
};

/** Admit main-file growth and the worst rollback journal before page writes. Disabling
 * spill bounds the journal to one image of each original page plus its header.
 * SQLite's page ceiling enforces the reservation even for unexpectedly large rows.
 */
export const semanticSqliteTransaction = ({ db, filename, diskAccount }) => fn => ({ immediate() {
  if (!diskAccount) return db.transaction(fn).immediate();
  let before = 0, allowance = 0;
  try {
    return db.transaction(() => {
      // BEGIN IMMEDIATE takes the writer lock without changing pages. Measure
      // after that lock so a different process cannot outgrow the journal bound.
      before = size(filename);
      const pageSize = db.pragma('page_size', { simple: true });
      const journal = Math.ceil(before / pageSize) * (pageSize + 8) + 131072;
      const growth = Math.floor((diskAccount.limit - diskAccount.used - journal) / pageSize) * pageSize;
      if (growth < pageSize) throw Object.assign(new Error('Semantic control journal exceeds disk allowance.'), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
      diskAccount.reserve(journal + growth);
      allowance = journal + growth;
      db.pragma('max_page_count = ' + (Math.ceil(before / pageSize) + growth / pageSize));
      return fn();
    }).immediate();
  } catch (error) {
    if (error.code === 'SQLITE_FULL') throw Object.assign(new Error('Semantic control transaction exceeds disk allowance.'), { code: 'ERR_SEMANTIC_DISK_LIMIT', cause: error });
    throw error;
  } finally {
    if (allowance) {
      const retained = size(filename) - before + size(filename + '-journal');
      // Uncertain excess is an invariant failure, never silently extra credit.
      if (retained > allowance) throw new Error('Semantic SQLite exceeded its admitted reservation.');
      diskAccount.release(allowance - retained);
    }
  }
} });
