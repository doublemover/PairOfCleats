import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { withSchedulerCpuSuspended } from '../../../src/shared/concurrency/scheduler-task-scope.js';
import { runScmCommand, setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { processScmFile, readFixture } from './scm-file-processor-test-helper.js';

const until = async predicate => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await tick();
  assert.ok(predicate());
};
const scheduler = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 100 });
const signal = new AbortController().signal;
const fixture = await readFixture('tests', 'fixtures', 'mixed', 'src', 'config.yml');
let parsing = false;
try {
  const file = scheduler.schedule('file', { cpu: 1, bytes: 100, signal }, () => processScmFile({ ...fixture,
    scmConfig: { allowSlowTimeouts: true, timeoutMs: 2000, annotate: {} }, gitBlameEnabled: false,
    runProc: fn => withSchedulerCpuSuspended(() => scheduler.schedule('proc', { cpu: 1, mem: 1, signal }, fn)),
    scmProviderImpl: { async getFileMeta() {
      const result = await runScmCommand(process.execPath,
        ['-e', 'setTimeout(() => process.stdout.write("metadata"), 100)'], { signal, outputMode: 'string' });
      assert.equal(result.stdout, 'metadata');
      assert.equal(scheduler.stats().tokens.cpu.used, 1, 'provider result parsing reacquires compute');
      parsing = true;
      return { ok: true, lastModifiedAt: '2026-10-23T00:00:00Z', lastAuthor: 'fixture', lastCommitId: 'abcdef0' };
    } }
  }));
  await until(() => scheduler.stats().queues.proc?.suspendedCpu === 1);
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  assert.equal(scheduler.stats().tokens.mem.used, 1, 'subprocess capacity survives command wait');
  assert.equal(scheduler.stats().activity.inFlightBytes, 100);
  await scheduler.schedule('ready', { cpu: 1, signal }, () => assert.equal(parsing, false));
  const result = await file; await tick();
  assert.ok(result);
  assert.equal(parsing, true);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  assert.equal(scheduler.stats().tokens.mem.used, 0);

  // Streaming hooks and alternate runners may execute JS throughout the wait.
  // Those routes keep their existing permit rather than claiming pure I/O.
  await scheduler.schedule('callback', { cpu: 1, signal }, () => runScmCommand(process.execPath,
    ['-e', 'process.stdout.write("hook")'], { signal, onStdout: () => {
      assert.equal(scheduler.stats().tokens.cpu.used, 1);
    } }));
  setScmCommandRunner(async () => {
    assert.equal(scheduler.stats().tokens.cpu.used, 1);
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  await scheduler.schedule('alternate', { cpu: 1, signal }, () => runScmCommand('fixture', [], { signal }));
} finally {
  setScmCommandRunner(null);
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
console.log('file SCM command waits retain memory and reacquire CPU before provider parsing');
