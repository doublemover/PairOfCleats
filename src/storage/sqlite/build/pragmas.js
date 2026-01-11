export const applyBuildPragmas = (db) => {
  try { db.pragma('journal_mode = WAL'); } catch {}
  try { db.pragma('synchronous = OFF'); } catch {}
  try { db.pragma('temp_store = MEMORY'); } catch {}
  try { db.pragma('cache_size = -200000'); } catch {}
  try { db.pragma('mmap_size = 268435456'); } catch {}
};

export const restoreBuildPragmas = (db) => {
  try { db.pragma('synchronous = NORMAL'); } catch {}
  try { db.pragma('temp_store = DEFAULT'); } catch {}
};
