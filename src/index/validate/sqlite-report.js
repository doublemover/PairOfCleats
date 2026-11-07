import fs from 'node:fs';
import path from 'node:path';
import { getIndexDir, resolveSqlitePaths } from '../../shared/dict-utils.js';
import { readJsonFile } from '../../shared/artifact-io/json.js';
import { validateSqliteZeroStateManifest } from '../../storage/sqlite/zero-state.js';
import { addIssue, validationErrorMetadata } from './issues.js';
import { createSqliteCacheCloseOwner } from '../../retrieval/sqlite-cache-close-owner.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { acquireNativeReaderStorage } from '../../shared/storage/native-reader.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

export const buildSqliteReport = async ({ root, userConfig, indexRoot, modes, report, sqliteEnabled, selection = null }) => {
  const sqlitePaths = selection ? {} : resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
  const keys = { code: 'codePath', prose: 'prosePath', 'extracted-prose': 'extractedProsePath', records: 'recordsPath' };
  const pathsByMode = Object.fromEntries(Object.entries(keys).map(([mode, key]) => [mode,
    selection ? selection.sqlitePaths[mode] || null : sqlitePaths[key]]));
  const sqliteMode = userConfig.sqlite?.scoreMode === 'fts' ? 'fts' : 'bm25';
  const sqliteTargets = new Set(modes.filter(mode => Object.hasOwn(keys, mode)
    && (!selection || selection.indexDirs[mode]) && selection?.backendRequirements?.sqlite?.[mode] !== false));
  const zeroStateModes = new Set();
  const zeroStateIssues = [];
  for (const mode of sqliteTargets) {
    const modeIndexDir = selection?.indexDirs[mode] || getIndexDir(root, mode, userConfig, indexRoot ? { indexRoot } : {});
    const zeroStateManifestPath = path.join(modeIndexDir, 'pieces', 'sqlite-zero-state.json');
    if (fs.existsSync(zeroStateManifestPath)) {
      try {
        await validateSqliteZeroStateManifest({ indexDir: modeIndexDir, mode,
          outputPath: pathsByMode[mode],
          payload: readJsonFile(zeroStateManifestPath, { containedRoot: modeIndexDir }) });
        zeroStateModes.add(mode);
      } catch (error) {
        zeroStateIssues.push({ mode, detail: `${mode} zero-state proof invalid (${error?.message || error})`, state: 'invalid' });
      }
    }
  }
  const requiredModes = [...sqliteTargets].filter(mode => !zeroStateModes.has(mode));
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
    code: pathsByMode.code,
    prose: pathsByMode.prose,
    extractedProse: pathsByMode['extracted-prose'],
    records: pathsByMode.records,
    zeroStateModes: Array.from(zeroStateModes).sort(),
    issues: []
  };
  sqliteReport.enabled = sqliteReport.enabled && sqliteTargets.size > 0;

  if (sqliteReport.enabled) {
    const sqliteIssues = [...zeroStateIssues], availableModes = [];
    for (const mode of requiredModes) {
      if (!fs.existsSync(pathsByMode[mode])) sqliteIssues.push({ mode, detail: `${mode} db missing`, state: 'missing' });
      else availableModes.push(mode);
    }
    if (sqliteIssues.length) {
      sqliteReport.ok = false;
      sqliteReport.issues.push(...sqliteIssues.map(row => row.detail));
      sqliteIssues.forEach(row => addIssue(report, row.mode, row.detail, null, 'issues',
        { capability: 'sqlite', displayScope: 'sqlite', state: row.state, artifact: 'sqlite', code: 'ERR_INDEX_SQLITE_ADMISSION' }));
      report.hints.push('Run `pairofcleats index build --stage 4` (or `node build_index.js --stage 4`) to rebuild SQLite artifacts.');
    }
    if (availableModes.length) {
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
          let db = null, close = null, nativeClosed = false;
          const storage = acquireNativeReaderStorage(dbPath, { repoRoot: root, userConfig }, () => nativeClosed);
          storage?.start();
          let primary, failed = false;
          try {
            try { db = new Database(dbPath, { readonly: true }); }
            catch (error) { storage?.failedOpen(error); throw error; }
            close = createSqliteCacheCloseOwner(db, { canClose: () => true, onClosed: () => {},
              onNativeClosed: () => { nativeClosed = true; storage?.releaseAfterClosure(); } });
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
          } catch (error) {
            primary = db && storage ? storage.retainFailure(error) : error; failed = true;
          }
          finally {
            try { close?.retire(); }
            catch (cleanupError) { throw failed ? addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true }) : cleanupError; }
          }
          if (failed) {
            observeStorageResource(primary, { phase: 'sqlite-validation' }).requireSettled();
            sqliteReport.ok = false;
            const issue = `${label} db validation failed (${primary?.code || 'invalid database'})`;
            sqliteReport.issues.push(issue);
            addIssue(report, label, issue, null, 'issues', { ...validationErrorMetadata(primary, 'sqlite', 'ERR_INDEX_SQLITE_INVALID'),
              capability: 'sqlite', displayScope: 'sqlite' });
          }
        };
        for (const mode of availableModes) checkTables(pathsByMode[mode], mode);
      }
    }
  }

  return sqliteReport;
};
