import fs from 'node:fs';
import path from 'node:path';
import { getIndexDir, resolveSqlitePaths } from '../../shared/dict-utils.js';
import { readJsonFile } from '../../shared/artifact-io/json.js';
import { validateSqliteZeroStateManifest } from '../../storage/sqlite/zero-state.js';
import { addIssue } from './issues.js';

export const buildSqliteReport = async ({ root, userConfig, indexRoot, modes, report, sqliteEnabled }) => {
  const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
  const sqliteMode = userConfig.sqlite?.scoreMode === 'fts' ? 'fts' : 'bm25';
  const sqliteTargets = new Set(modes.filter((mode) => mode === 'code' || mode === 'prose'));
  const zeroStateModes = new Set();
  const zeroStateIssues = [];
  for (const mode of sqliteTargets) {
    const modeIndexDir = getIndexDir(root, mode, userConfig, indexRoot ? { indexRoot } : {});
    const zeroStateManifestPath = path.join(modeIndexDir, 'pieces', 'sqlite-zero-state.json');
    if (fs.existsSync(zeroStateManifestPath)) {
      try {
        await validateSqliteZeroStateManifest({ indexDir: modeIndexDir, mode,
          outputPath: mode === 'code' ? sqlitePaths.codePath : sqlitePaths.prosePath,
          payload: readJsonFile(zeroStateManifestPath, { containedRoot: modeIndexDir }) });
        zeroStateModes.add(mode);
      } catch (error) {
        zeroStateIssues.push({ mode, detail: `${mode} zero-state proof invalid (${error?.message || error})`, state: 'invalid' });
      }
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
    const sqliteIssues = [...zeroStateIssues];
    if (requireCodeDb && !fs.existsSync(sqlitePaths.codePath)) sqliteIssues.push({ mode: 'code', detail: 'code db missing', state: 'missing' });
    if (requireProseDb && !fs.existsSync(sqlitePaths.prosePath)) sqliteIssues.push({ mode: 'prose', detail: 'prose db missing', state: 'missing' });
    if (sqliteIssues.length) {
      sqliteReport.ok = false;
      sqliteReport.issues.push(...sqliteIssues.map(row => row.detail));
      sqliteIssues.forEach(row => addIssue(report, row.mode, row.detail, null, 'issues',
        { capability: 'sqlite', displayScope: 'sqlite', state: row.state, artifact: 'sqlite', code: 'ERR_INDEX_SQLITE_ADMISSION' }));
      report.hints.push('Run `pairofcleats index build --stage 4` (or `node build_index.js --stage 4`) to rebuild SQLite artifacts.');
    } else if (requireCodeDb || requireProseDb) {
      let Database = null;
      try {
        ({ default: Database } = await import('better-sqlite3'));
      } catch {
        sqliteReport.ok = false;
        const issue = 'better-sqlite3 not available';
        sqliteReport.issues.push(issue);
        addIssue(report, null, issue, null, 'issues', { capability: 'sqlite', displayScope: 'sqlite', artifact: 'sqlite', state: 'unverified', code: 'ERR_INDEX_SQLITE_UNAVAILABLE' });
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
              addIssue(report, label, issue, null, 'issues', { capability: 'sqlite', displayScope: 'sqlite', artifact: 'sqlite', code: 'ERR_INDEX_SQLITE_TABLES' });
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
