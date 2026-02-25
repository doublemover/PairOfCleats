import fs from 'node:fs';
import path from 'node:path';
import { getIndexDir, resolveSqlitePaths } from '../../shared/dict-utils.js';

export const buildSqliteReport = async ({ root, userConfig, indexRoot, modes, report, sqliteEnabled }) => {
  const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
  const sqliteMode = userConfig.sqlite?.scoreMode === 'fts' ? 'fts' : 'bm25';
  const sqliteTargets = new Set(modes.filter((mode) => mode === 'code' || mode === 'prose'));
  const zeroStateModes = new Set();
  for (const mode of sqliteTargets) {
    const modeIndexDir = getIndexDir(root, mode, userConfig, indexRoot ? { indexRoot } : {});
    const zeroStateManifestPath = path.join(modeIndexDir, 'pieces', 'sqlite-zero-state.json');
    if (fs.existsSync(zeroStateManifestPath)) {
      zeroStateModes.add(mode);
    }
  }
  const requireCodeDb = sqliteTargets.has('code') && !zeroStateModes.has('code');
  const requireProseDb = sqliteTargets.has('prose') && !zeroStateModes.has('prose');
  const sqliteRequiredTables = sqliteMode === 'fts'
    ? ['chunks', 'chunks_fts', 'minhash_signatures', 'dense_vectors', 'dense_meta']
    : [
      'chunks',
      'token_vocab',
      'token_postings',
      'doc_lengths',
      'token_stats',
      'phrase_vocab',
      'phrase_postings',
      'chargram_vocab',
      'chargram_postings',
      'minhash_signatures',
      'dense_vectors',
      'dense_meta'
    ];

  const sqliteReport = {
    enabled: sqliteEnabled,
    mode: sqliteMode,
    ok: true,
    code: sqlitePaths.codePath,
    prose: sqlitePaths.prosePath,
    zeroStateModes: Array.from(zeroStateModes).sort(),
    issues: []
  };
  sqliteReport.enabled = sqliteReport.enabled && sqliteTargets.size > 0;

  if (sqliteReport.enabled) {
    const sqliteIssues = [];
    if (requireCodeDb && !fs.existsSync(sqlitePaths.codePath)) sqliteIssues.push('code db missing');
    if (requireProseDb && !fs.existsSync(sqlitePaths.prosePath)) sqliteIssues.push('prose db missing');
    if (sqliteIssues.length) {
      sqliteReport.ok = false;
      sqliteReport.issues.push(...sqliteIssues);
      sqliteIssues.forEach((issue) => report.issues.push(`[sqlite] ${issue}`));
      report.hints.push('Run `pairofcleats index build --stage 4` (or `node build_index.js --stage 4`) to rebuild SQLite artifacts.');
    } else if (requireCodeDb || requireProseDb) {
      let Database = null;
      try {
        ({ default: Database } = await import('better-sqlite3'));
      } catch {
        sqliteReport.ok = false;
        const issue = 'better-sqlite3 not available';
        sqliteReport.issues.push(issue);
        report.issues.push(`[sqlite] ${issue}`);
        report.hints.push('Run `npm install` to install better-sqlite3.');
      }
      if (Database) {
        const checkTables = (dbPath, label) => {
          const db = new Database(dbPath, { readonly: true });
          try {
            const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = new Set(rows.map((row) => row.name));
            const missing = sqliteRequiredTables.filter((name) => !tableNames.has(name));
            if (missing.length) {
              sqliteReport.ok = false;
              const issue = `${label} missing tables: ${missing.join(', ')}`;
              sqliteReport.issues.push(issue);
              report.issues.push(`[sqlite] ${issue}`);
              report.hints.push('Run `pairofcleats index build --stage 4` (or `node build_index.js --stage 4`) to rebuild SQLite artifacts.');
            }
          } finally {
            db.close();
          }
        };
        if (requireCodeDb) checkTables(sqlitePaths.codePath, 'code');
        if (requireProseDb) checkTables(sqlitePaths.prosePath, 'prose');
      }
    }
  }

  return sqliteReport;
};
