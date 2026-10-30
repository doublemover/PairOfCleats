import assert from 'node:assert/strict';
import { admitSqliteBenchmarkPhaseDiagnostics } from '../../../../tools/bench/sqlite/phase-diagnostics.js';

// Independent wire examples exercise only the parent admission protocol. The
// companion phase-observer fixture binds this admission to actual native work.
const phase = (state, id, name, at, durationMs) => ({ kind: 'sqlite-qualification-phase', state, id, phase: name,
  elapsedMs: at, ...(durationMs === undefined ? {} : { durationMs }) });
const original = [phase('start', 1, 'source-admission', 0), phase('end', 1, 'source-admission', 1, 1),
  phase('start', 2, 'bundle-build', 2), phase('start', 3, 'native-open', 3), phase('end', 3, 'native-open', 4, 1),
  { kind: 'sqlite-qualification-phase', state: 'progress', phase: 'bundle-insertion', elapsedMs: 5, completedFiles: 328, totalFiles: 328 },
  phase('start', 4, 'native-close', 6), phase('end', 4, 'native-close', 7, 1), phase('end', 2, 'bundle-build', 8, 6),
  phase('start', 5, 'database-validation', 9), phase('end', 5, 'database-validation', 10, 1)];
const summary = () => ({ records: original.length, droppedRecords: 0, progressRecords: 1, progressSuppressed: 0,
  active: [], qualification: 'diagnostics;not-resource-settlement-authority' });
const input = () => ({ stderr: original.map(row => JSON.stringify(row)).join('\n') + '\n',
  report: { phaseDiagnostics: summary() }, request: { command: 'seed' } });
assert.equal(admitSqliteBenchmarkPhaseDiagnostics(input()).state, 'accepted');
assert.equal(admitSqliteBenchmarkPhaseDiagnostics({ stderr: '', report: { command: 'prepare' }, request: { command: 'prepare' } }).state, 'accepted');
const rejected = mutate => {
  const value = input(); mutate(value); assert.throws(() => admitSqliteBenchmarkPhaseDiagnostics(value));
};
const changeRow = (value, at, mutate) => {
  const rows = value.stderr.trimEnd().split('\n').map(row => JSON.parse(row)); mutate(rows[at]);
  value.stderr = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
};
for (const unknown of ['warning: original native failure\n', 'not JSON\n', '{}\n', '{"kind":"different-protocol"}\n']) {
  rejected(value => { value.stderr += unknown; value.report.phaseDiagnostics.records++; });
}
rejected(value => { value.stderr = ' '.repeat(128 * 1024 + 1); });
rejected(value => { value.stderr = value.stderr.trimEnd(); });
rejected(value => { value.stderr += '\n'; value.report.phaseDiagnostics.records++; });
rejected(value => { value.report.phaseDiagnostics.records++; });
rejected(value => { value.report.phaseDiagnostics.progressRecords = 0; });
rejected(value => { value.report.phaseDiagnostics.progressSuppressed = -1; });
rejected(value => { value.report.phaseDiagnostics.droppedRecords = 1; });
rejected(value => { value.report.phaseDiagnostics.active = ['native-close']; });
rejected(value => { value.report.phaseDiagnostics.unknown = true; });
rejected(value => { value.report.phaseDiagnostics.qualification = 'resource-settled'; });
rejected(value => changeRow(value, 0, row => { row.unknown = true; }));
rejected(value => changeRow(value, 0, row => { row.phase = 'new-unqualified-phase'; }));
rejected(value => changeRow(value, 3, row => { row.id = 2; }));
rejected(value => changeRow(value, 4, row => { row.phase = 'native-close'; }));
rejected(value => changeRow(value, 4, row => { row.state = 'failed'; }));
rejected(value => changeRow(value, 4, row => { row.elapsedMs = 0; }));
rejected(value => changeRow(value, 4, row => { row.durationMs = null; }));
rejected(value => changeRow(value, 5, row => { row.completedFiles = 329; }));
rejected(value => changeRow(value, 5, row => { row.phase = 'filter-facts-rebuild'; row.id = 99; row.batches = 64; row.rows = 8192; }));
rejected(value => changeRow(value, 10, row => { row.state = 'start'; delete row.durationMs; row.id = 6; }));
rejected(value => { value.request = { command: 'arm', operation: 'build' }; value.report.status = 'failed'; });
rejected(value => { value.request = { command: 'arm', operation: 'update' }; value.report.status = 'completed'; });
assert.throws(() => admitSqliteBenchmarkPhaseDiagnostics({ stderr: 'warning\n', report: {}, request: { command: 'prepare' } }));
assert.throws(() => admitSqliteBenchmarkPhaseDiagnostics({ stderr: '', report: { phaseDiagnostics: summary() }, request: { command: 'prepare' } }));
const truncation = input();
truncation.stderr = JSON.stringify({ kind: 'sqlite-qualification-phase', state: 'diagnostics-truncated', maxRecords: 256, elapsedMs: 1 }) + '\n';
truncation.report.phaseDiagnostics.records = 1; truncation.report.phaseDiagnostics.droppedRecords = 1;
assert.throws(() => admitSqliteBenchmarkPhaseDiagnostics(truncation));
const completePrefix = structuredClone(original);
for (let n = 0; n < 122; n++) {
  completePrefix.push(phase('start', 6 + n, 'native-schema', 11 + n * 2));
  completePrefix.push(phase('end', 6 + n, 'native-schema', 12 + n * 2, 1));
}
assert.equal(completePrefix.length, 255);
completePrefix.push({ kind: 'sqlite-qualification-phase', state: 'diagnostics-truncated', maxRecords: 256, elapsedMs: 255 });
const boundedTruncation = input();
boundedTruncation.stderr = completePrefix.map(row => JSON.stringify(row)).join('\n') + '\n';
Object.assign(boundedTruncation.report.phaseDiagnostics, { records: 256, droppedRecords: 1 });
assert.throws(() => admitSqliteBenchmarkPhaseDiagnostics(boundedTruncation), /Truncated phase evidence cannot qualify/);
console.log('Private SQLite parent admission rejects warnings, unknown stderr, malformed/counter/phase mismatches and unqualified child success.');
