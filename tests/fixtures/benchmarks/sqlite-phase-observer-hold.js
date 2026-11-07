import { writeSync } from 'node:fs';
import { createSqliteBenchmarkPhaseObserver } from '../../../tools/bench/sqlite/phase-observer.js';

// A controlled synchronous native-call seam. This tests diagnostics surviving
// forced child termination, not an actual SQLite stall or a performance sample.
class HeldDatabase {
  exec() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
  pragma() {}
  prepare() {}
  close() {}
}
const observer = createSqliteBenchmarkPhaseObserver({ emit: row => writeSync(2, JSON.stringify(row) + '\n') });
const Observed = observer.wrapDatabase(HeldDatabase);
new Observed().exec('COMMIT');
