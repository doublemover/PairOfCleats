import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

// Controlled signal dispatch exercises real fresh-process event-loop lifetime
// on every platform, including Windows, without killing a test by POSIX signal.
// The original POSIX postinstall signal assertion remains unchanged.
for (const delayedDispatch of [false, true]) {
  for (const rejectCleanup of [false, true]) {
    const script = `
      import { installTrackedSubprocessHooks } from './src/shared/subprocess/signals.js';
      import { exitLikeChildResult } from './src/shared/subprocess/exit-semantics.js';
      let closed = false;
      installTrackedSubprocessHooks(() => new Promise((resolve, reject) => {
        setTimeout(() => {
          closed = true;
          process.stdout.write('CLEANUP_SETTLED\\n');
          ${rejectCleanup ? "reject(new Error('controlled shutdown failure'));" : 'resolve();'}
        }, 25).unref();
      }));
      process.kill = (pid, signal) => {
        if (pid !== process.pid || signal !== 'SIGTERM') throw new Error('unexpected signal target');
        if (process.listenerCount(signal)) {
          ${delayedDispatch ? "setTimeout(() => process.emit(signal, signal), 25).unref();" : 'process.emit(signal, signal);'}
        } else {
          if (!closed) throw new Error('signal forwarded before controlled cleanup settled');
          process.stdout.write('FORWARDED:SIGTERM\\n');
          process.exit(143);
        }
        return true;
      };
      exitLikeChildResult({ status: null, signal: 'SIGTERM' });
    `;
    const result = await spawnSubprocess(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(), timeoutMs: 3000, maxOutputBytes: 16384, outputEncoding: 'utf8',
      rejectOnNonZeroExit: false, stdio: 'pipe'
    });
    assert.equal(result.exitCode, 143, JSON.stringify({ delayedDispatch, rejectCleanup, ...result }));
    assert.equal(result.signal, null, 'portable fixture controls default forwarding instead of issuing a native signal');
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['CLEANUP_SETTLED', 'FORWARDED:SIGTERM']);
    assert.equal(result.stderr, '');
  }
}
for (const customHandlerFirst of [false, true]) {
  const script = `
    import { installTrackedSubprocessHooks } from './src/shared/subprocess/signals.js';
    import { exitLikeChildResult } from './src/shared/subprocess/exit-semantics.js';
    const registerCustom = () => process.on('SIGTERM', () => {
      setTimeout(() => {
        process.stdout.write('CUSTOM_DONE\\n');
        process.exit(0);
      }, 50);
    });
    ${customHandlerFirst ? 'registerCustom();' : ''}
    installTrackedSubprocessHooks(async () => {
      process.stdout.write('CLEANUP_SETTLED\\n');
    });
    ${customHandlerFirst ? '' : 'registerCustom();'}
    process.kill = (pid, signal) => {
      if (pid !== process.pid || signal !== 'SIGTERM') throw new Error('unexpected signal target');
      if (!process.listenerCount(signal)) throw new Error('custom shutdown lost signal authority');
      setTimeout(() => process.emit(signal, signal), 25).unref();
      return true;
    };
    exitLikeChildResult({ status: null, signal: 'SIGTERM' });
  `;
  const result = await spawnSubprocess(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(), timeoutMs: 3000, maxOutputBytes: 16384, outputEncoding: 'utf8',
    rejectOnNonZeroExit: false, stdio: 'pipe'
  });
  assert.equal(result.exitCode, 0, JSON.stringify({ customHandlerFirst, ...result }));
  assert.equal(result.signal, null);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['CLEANUP_SETTLED', 'CUSTOM_DONE']);
  assert.equal(result.stderr, '');
}
console.log('signal dispatch and bounded cleanup retain process lifetime until default forwarding');
