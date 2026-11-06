import assert from 'node:assert/strict';
import { runNativeSetupCommand, settledNativeSetupFailure } from '../../../tools/setup/native-command-result.js';
import { createAbortError } from '../../../src/shared/abort.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/native-setup-failure-fence/')[1];
assert.ok(['original-failures', 'pending-resource-fence', 'transcript-status', 'cancellation-and-status'].includes(mode));
const execute = spawn => runNativeSetupCommand('inert-recording-native-command', [], {}, { spawn });
if (mode === 'original-failures') {
  for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('original compiler launch failure'))]) {
    const result = await execute(async () => { throw original; });
    assert.equal(result.ok, false); assert.equal(result.error, original); assert.equal(typeof result.message, 'string');
  }
  let reads = 0;
  const original = Object.defineProperty(new Error('original native failure'), 'result', { get() { reads++; throw new Error('diagnostic accessor'); } });
  const result = await execute(async () => { throw original; });
  assert.equal(result.error, original); assert.equal(reads, 0); assert.equal(Object.hasOwn(result, 'stdout'), false);
  const inspection = new Error('message inspection failure'), throwing = Object.defineProperty({}, 'message', { get() { throw inspection; } });
  await assert.rejects(execute(async () => { throw throwing; }), failure => errorGraphIncludes(failure, throwing) && errorGraphIncludes(failure, inspection));
} else if (mode === 'pending-resource-fence') {
  for (const boundary of ['build', 'probe']) {
    let settled = false, launches = 0, fallbacks = 0;
    const original = Object.assign(new Error('actual native child still owns its resources'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    });
    let failure;
    try {
      const result = boundary === 'probe' ? settledNativeSetupFailure(original, 'native-activation-probe')
        : await execute(async () => { launches++; throw original; });
      if (!result.ok) fallbacks++;
      assert.fail('Unsettled native work cannot become an ordinary failed result');
    } catch (error) { failure = error; }
    assert.equal(fallbacks, 0); assert.equal(launches, boundary === 'build' ? 1 : 0);
    assert.equal(errorGraphIncludes(failure, original), true); assert.equal(failure.cacheOwnershipReleased(), false);
    original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false, 'rewritten diagnostics do not settle the captured original child');
    settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
} else if (mode === 'transcript-status') {
  for (const exitCode of [0, 2]) {
    const result = { exitCode, signal: null, stdout: 'unaltered compiler bytes\r\n', stderr: 'bounded original tail',
      outputCapture: { stdout: { truncated: true }, stderr: { truncated: false } } };
    let fallbacks = 0;
    await assert.rejects((async () => {
      const projected = await execute(async () => result); if (!projected.ok) fallbacks++;
    })(), error => error.code === 'ERR_NATIVE_SETUP_TRANSCRIPT_LIMIT' && error.result.compilerStatus === (exitCode === 0 ? 'succeeded' : 'failed')
      && error.result.stdout === result.stdout && error.result.diagnostics.complete === false);
    assert.equal(fallbacks, 0, 'incomplete evidence never starts another native attempt');
  }
} else {
  const abort = createAbortError(); Object.defineProperty(abort, 'cause', { value: false });
  await assert.rejects(execute(async () => { throw abort; }), error => error === abort && error.cause === false);
  const signal = new AbortController(); signal.abort();
  const original = new Error('unrelated original failure');
  const failed = await runNativeSetupCommand('inert', [], { signal: signal.signal }, { spawn: async () => { throw original; } });
  assert.equal(failed.error, original, 'coincident cancellation does not reclassify an unrelated failure');
  for (const [exitCode, nativeSignal, message] of [[0, null, null], [7, null, 'exit 7'], [null, 'SIGTERM', 'signal SIGTERM']]) {
    const result = await execute(async () => ({ exitCode, signal: nativeSignal, stdout: 'raw out', stderr: 'raw err' }));
    assert.equal(result.ok, exitCode === 0); assert.equal(result.message, message);
    assert.equal(result.stdout, 'raw out'); assert.equal(result.stderr, 'raw err');
  }
}
console.log('Native setup preserves original child retirement before failure projection or fallback admission');
