import fsSync from 'node:fs';

const fileSignature = (filePath) => {
  try {
    const stat = fsSync.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
};

export function createSqliteDbCache() {
  const entries = new Map();

  const get = (dbPath) => {
    const entry = entries.get(dbPath);
    if (!entry) return null;
    const signature = fileSignature(dbPath);
    if (!signature || signature !== entry.signature) {
      try {
        entry.db?.close?.();
      } catch {}
      entries.delete(dbPath);
      return null;
    }
    return entry.db || null;
  };

  const set = (dbPath, db) => {
    const signature = fileSignature(dbPath);
    entries.set(dbPath, { db, signature });
  };

  const close = (dbPath) => {
    const entry = entries.get(dbPath);
    if (!entry) return;
    try {
      entry.db?.close?.();
    } catch {}
    entries.delete(dbPath);
  };

  const closeAll = () => {
    for (const dbPath of entries.keys()) {
      close(dbPath);
    }
  };

  return {
    get,
    set,
    close,
    closeAll,
    size: () => entries.size
  };
}
