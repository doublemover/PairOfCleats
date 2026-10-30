import assert from 'node:assert/strict';

const phases = new Set(['source-admission', 'bundle-build', 'incremental-update', 'initial-build',
  'initial-native-backup', 'initial-validation', 'database-validation', 'native-open', 'native-close',
  'transaction-begin', 'transaction-commit', 'transaction-rollback', 'native-schema', 'chunk-indexes',
  'filter-facts-schema', 'filter-facts-rebuild', 'filter-facts-seal', 'filter-facts-seal-publication',
  'fts-optimize', 'database-optimize', 'wal-checkpoint']);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const keys = (value, required, optional = []) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Invalid SQLite diagnostic object.');
  assert.ok(required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'Invalid SQLite diagnostic fields.');
};

/** Admit only the private worker's finite diagnostic protocol. Arbitrary stderr,
 * warnings, failed/unfinished phases and incomplete evidence remain failures.
 * This validates evidence, never resource settlement or numerical performance.
 */
export const admitSqliteBenchmarkPhaseDiagnostics = ({ stderr, report, request }) => {
  assert.equal(typeof stderr, 'string');
  assert.ok(Buffer.byteLength(stderr) <= 128 * 1024, 'SQLite phase diagnostics exceed their byte bound.');
  if (request.command === 'prepare') {
    assert.equal(stderr, '', 'Preparation must not emit unclassified stderr.');
    assert.equal(Object.hasOwn(report, 'phaseDiagnostics'), false);
    return { state: 'accepted', records: [], progressSuppressed: 0 };
  }
  assert.ok(['seed', 'arm'].includes(request.command));
  if (request.command === 'arm') assert.equal(report.status, 'completed');
  const summary = report.phaseDiagnostics;
  keys(summary, ['records', 'droppedRecords', 'progressRecords', 'progressSuppressed', 'active', 'qualification']);
  assert.equal(summary.qualification, 'diagnostics;not-resource-settlement-authority');
  assert.ok([summary.records, summary.droppedRecords, summary.progressRecords, summary.progressSuppressed].every(integer));
  assert.ok(summary.records > 0 && summary.records <= 256 && summary.progressRecords <= 24);
  assert.deepEqual(summary.active, [], 'A successful child cannot retain unfinished phases.');
  assert.ok(stderr.endsWith('\n'), 'SQLite diagnostics must contain complete JSON lines.');
  const lines = stderr.slice(0, -1).split('\n');
  assert.equal(lines.length, summary.records, 'SQLite phase record count disagrees with its report.');
  const records = lines.map(line => JSON.parse(line));
  const active = [], completed = [], begun = new Set();
  let priorElapsed = 0, lastId = 0, progressRecords = 0, truncated = false;
  for (const [index, row] of records.entries()) {
    assert.equal(row?.kind, 'sqlite-qualification-phase', 'Unknown SQLite stderr record.');
    assert.ok(duration(row.elapsedMs) && row.elapsedMs >= priorElapsed, 'Invalid SQLite phase clock.');
    priorElapsed = row.elapsedMs;
    if (row.state === 'diagnostics-truncated') {
      keys(row, ['kind', 'state', 'maxRecords', 'elapsedMs']);
      assert.equal(row.maxRecords, 256); assert.equal(index, 255); assert.equal(index, records.length - 1);
      truncated = true; continue;
    }
    assert.ok(['start', 'end', 'failed', 'progress'].includes(row.state), 'Unknown SQLite phase state.');
    if (row.state === 'progress') {
      progressRecords++;
      if (row.phase === 'filter-facts-rebuild') {
        keys(row, ['kind', 'state', 'phase', 'elapsedMs', 'id', 'batches', 'rows']);
        assert.ok(integer(row.batches) && row.batches > 0 && row.batches % 64 === 0 && integer(row.rows));
        assert.ok(active.some(value => value.id === row.id && value.phase === row.phase));
      } else {
        assert.equal(row.phase, 'bundle-insertion');
        keys(row, ['kind', 'state', 'phase', 'elapsedMs'], ['completedFiles', 'totalFiles']);
        if (Object.hasOwn(row, 'completedFiles') || Object.hasOwn(row, 'totalFiles')) {
          assert.ok(integer(row.completedFiles) && integer(row.totalFiles) && row.completedFiles <= row.totalFiles);
        }
        assert.ok(active.some(value => ['bundle-build', 'initial-build', 'incremental-update'].includes(value.phase)));
      }
      continue;
    }
    keys(row, ['kind', 'state', 'phase', 'elapsedMs', 'id'], row.state === 'start' ? [] : ['durationMs']);
    assert.ok(phases.has(row.phase) && integer(row.id) && row.id > 0);
    if (row.state === 'start') {
      assert.equal(row.id, lastId + 1); lastId = row.id;
      active.push({ id: row.id, phase: row.phase }); begun.add(row.phase);
    } else {
      assert.ok(Object.hasOwn(row, 'durationMs') && duration(row.durationMs) && row.durationMs <= row.elapsedMs);
      assert.deepEqual(active.pop(), { id: row.id, phase: row.phase }, 'SQLite phase closure does not match its original start.');
      assert.equal(row.state, 'end', 'A successful child reported a failed native/build phase.');
      completed.push(row.phase);
    }
  }
  assert.equal(progressRecords, summary.progressRecords);
  assert.equal(truncated, summary.droppedRecords > 0, 'SQLite truncation counter disagrees with raw evidence.');
  assert.equal(truncated, false, 'Truncated phase evidence cannot qualify a successful child.');
  assert.deepEqual(active, [], 'Raw SQLite phases remain unfinished.');
  for (const phase of ['source-admission', 'native-open', 'native-close', 'database-validation',
    request.command === 'seed' || request.operation === 'build' ? 'bundle-build' : 'incremental-update']) {
    assert.ok(begun.has(phase) && completed.includes(phase), 'Missing actual SQLite phase: ' + phase);
  }
  assert.equal(completed.filter(phase => phase === 'native-open').length, completed.filter(phase => phase === 'native-close').length);
  return { state: 'accepted', records, progressSuppressed: summary.progressSuppressed };
};
