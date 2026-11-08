import { performance } from 'node:perf_hooks';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

/** Private qualification diagnostics. Original native receivers/methods remain
 * the only work/close owners. Bounded synchronous records survive a child killed
 * while a native call blocks its event loop; they are not settlement receipts.
 */
export const createSqliteBenchmarkPhaseObserver = ({ emit, clock = () => performance.now() }) => {
  if (typeof emit !== 'function') throw new TypeError('SQLite phase diagnostics require a synchronous emitter.');
  const startedAt = clock(), maxRecords = 256;
  let records = 0, droppedRecords = 0, nextId = 0, progressRecords = 0, progressSuppressed = 0;
  const active = new Map();
  const write = value => {
    if (records >= maxRecords) { droppedRecords++; return; }
    if (records === maxRecords - 1) {
      records++; droppedRecords++;
      emit({ kind: 'sqlite-qualification-phase', state: 'diagnostics-truncated', maxRecords,
        elapsedMs: clock() - startedAt }); return;
    }
    records++;
    emit({ kind: 'sqlite-qualification-phase', ...value, elapsedMs: clock() - startedAt });
  };
  const start = phase => {
    const id = ++nextId, at = clock(); active.set(id, { phase, at });
    write({ state: 'start', id, phase }); return id;
  };
  const progress = value => {
    // Reserve the event budget for physical phase/close boundaries. The coarse
    // samples are explicitly coalesced, separately from lost/truncated records.
    if (progressRecords >= 24) { progressSuppressed++; return; }
    progressRecords++; write({ state: 'progress', ...value });
  };
  const end = (id, failed) => {
    const value = active.get(id); active.delete(id);
    write({ state: failed ? 'failed' : 'end', id, phase: value.phase, durationMs: clock() - value.at });
  };
  const finish = (id, failed, primary) => {
    try { end(id, failed); }
    catch (diagnostic) {
      throw failed ? addStorageFailureContext(primary, {}, diagnostic, { secondaryPresent: true }) : diagnostic;
    }
    if (failed) throw primary;
  };
  const sync = (phase, operation) => {
    const id = start(phase); let failed = false, primary, result;
    try { result = operation(); } catch (error) { failed = true; primary = error; }
    finish(id, failed, primary); return result;
  };
  const run = async (phase, operation) => {
    const id = start(phase); let failed = false, primary, result;
    try { result = await operation(); } catch (error) { failed = true; primary = error; }
    finish(id, failed, primary); return result;
  };
  const wrapDatabase = Database => function ObservedDatabase(...args) {
    const db = sync('native-open', () => new Database(...args));
    const exec = db.exec, pragma = db.pragma, prepare = db.prepare, close = db.close;
    db.exec = function (sql, ...rest) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      const phase = /^BEGIN\b/i.test(text) ? 'transaction-begin'
        : /^COMMIT\b/i.test(text) ? 'transaction-commit'
          : /^ROLLBACK\b/i.test(text) ? 'transaction-rollback'
            : /VALUES\s*\('optimize'\)/i.test(text) ? 'fts-optimize'
              : /CREATE INDEX idx_chunks_file_id/i.test(text) ? 'chunk-indexes'
                : /CREATE TABLE IF NOT EXISTS chunk_filter_facts/i.test(text) ? 'filter-facts-schema'
                  : 'native-schema';
      return sync(phase, () => exec.call(db, sql, ...rest));
    };
    db.pragma = function (sql, ...rest) {
      const phase = /wal_checkpoint/i.test(sql) ? 'wal-checkpoint'
        : /^(?:optimize|analysis_limit)/i.test(sql) ? 'database-optimize' : null;
      return phase ? sync(phase, () => pragma.call(db, sql, ...rest)) : pragma.call(db, sql, ...rest);
    };
    db.prepare = function (sql, ...rest) {
      const statement = prepare.call(db, sql, ...rest);
      if (/INSERT INTO chunk_filter_facts_meta/i.test(sql)) {
        const invoke = statement.run;
        statement.run = function (...bindings) { return sync('filter-facts-seal-publication', () => invoke.apply(statement, bindings)); };
      }
      if (/^SELECT (?:1|COUNT\(\*\)) FROM (?:chunks c LEFT JOIN chunk_filter_facts|chunk_filter_facts)/i.test(String(sql).trim())) {
        const get = statement.get;
        statement.get = function (...bindings) { return sync('filter-facts-seal', () => get.apply(statement, bindings)); };
      }
      if (/SELECT id,chunk_id,mode,file,ext,kind,metaV2_json FROM chunks/i.test(String(sql).replace(/\s+/g, ' '))) {
        const all = statement.all;
        let phase = null, batches = 0, rows = 0;
        statement.all = function (...bindings) {
          if (phase === null) phase = start('filter-facts-rebuild');
          let result;
          try { result = all.apply(statement, bindings); }
          catch (error) { const id = phase; phase = null; finish(id, true, error); }
          batches++; rows += result.length;
          if (!result.length) { const id = phase; phase = null; end(id, false); }
          else if (batches % 64 === 0) progress({ id: phase, phase: 'filter-facts-rebuild', batches, rows });
          return result;
        };
      }
      return statement;
    };
    db.close = function (...rest) { return sync('native-close', () => close.apply(db, rest)); };
    return db;
  };
  return Object.freeze({ run, wrapDatabase, progress: message => {
    const counts = /bundles (\d+)\/(\d+)/.exec(message || '');
    progress({ phase: 'bundle-insertion', ...(counts
      ? { completedFiles: Number(counts[1]), totalFiles: Number(counts[2]) } : {}) });
  }, snapshot: () => ({ records, droppedRecords, progressRecords, progressSuppressed,
    active: [...active.values()].map(({ phase }) => phase), qualification: 'diagnostics;not-resource-settlement-authority' }) });
};
