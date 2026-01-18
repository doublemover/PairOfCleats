const applyPragma = (db, pragma, label) => {
  try {
    db.pragma(pragma);
  } catch (err) {
    const suffix = label ? ` (${label})` : '';
    console.warn(`[sqlite] Failed to apply pragma${suffix}: ${err?.message || err}`);
  }
};

export const applyBuildPragmas = (db) => {
  applyPragma(db, 'journal_mode = WAL', 'journal_mode');
  applyPragma(db, 'synchronous = OFF', 'synchronous');
  applyPragma(db, 'temp_store = MEMORY', 'temp_store');
  applyPragma(db, 'cache_size = -200000', 'cache_size');
  applyPragma(db, 'mmap_size = 268435456', 'mmap_size');
};

export const restoreBuildPragmas = (db) => {
  applyPragma(db, 'synchronous = NORMAL', 'synchronous');
  applyPragma(db, 'temp_store = DEFAULT', 'temp_store');
};
