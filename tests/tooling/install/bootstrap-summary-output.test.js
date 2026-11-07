import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { withBootstrapSummaryOutput } from '../../../tools/setup/summary-output.js';
import { writeBootstrapDiagnosticBytes } from '../../../tools/setup/task-progress-output.js';
import { withCheckoutMutation } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/bootstrap-summary-output/')[1];
assert.ok(['independent-domain-and-transport-failures', 'failed-transport-stops-admission',
  'human-projection-and-raw-byte-parity', 'raw-buffer-captured-before-admission'].includes(mode));
const root = await makeTempDir('bootstrap-summary-output-');
try {
  if (mode === 'independent-domain-and-transport-failures') {
    for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('original compiler failure'))]) {
      const pipe = Object.freeze(Object.assign(new Error('independent real summary pipe failure'), { code: 'EPIPE' }));
      const stderr = new Writable({ write(chunk, encoding, callback) { queueMicrotask(() => callback(pipe)); } });
      let classified = false;
      const actual = await withCheckoutMutation(root, session => withBootstrapSummaryOutput(root, session, async summary => {
        await summary.status('compiler has failed'); classified = true; throw original;
      }, { stderr })).catch(error => error);
      assert.equal(classified, true); assert.equal(errorGraphIncludes(actual, original), true); assert.equal(errorGraphIncludes(actual, pipe), true);
      assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
      assert.equal(stderr.listenerCount('error'), 0); assert.equal(stderr.listenerCount('close'), 0);
    }
  } else if (mode === 'failed-transport-stops-admission') {
    const pipe = Object.assign(new Error('actual status transport failed'), { code: 'EPIPE' }); let launched = false;
    const stderr = new Writable({ write(chunk, encoding, callback) { callback(pipe); } });
    const actual = await withCheckoutMutation(root, session => withBootstrapSummaryOutput(root, session, async summary => {
      await summary.status('before next actual operation'); summary.check(); launched = true;
    }, { stderr })).catch(error => error);
    assert.equal(launched, false); assert.equal(actual.code, 'ERR_BOOTSTRAP_SUMMARY_OUTPUT'); assert.equal(errorGraphIncludes(actual, pipe), true);
  } else if (mode === 'human-projection-and-raw-byte-parity') {
    const chunks = [], stream = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    const raw = '\u001b[31mraw bytes\r\n{"value":"é🤓"}\n'; let projected;
    await withCheckoutMutation(root, session => withBootstrapSummaryOutput(root, session, async summary => {
      await summary.status('\u001b[31mselected toolchain\u001b[0m\n' + 'é'.repeat(3000));
      projected = Buffer.concat(chunks); chunks.length = 0;
      await summary.raw(raw, stream); return 'original result';
    }, { stderr: stream }));
    assert.match(projected.toString(), /^selected toolchain\n/); assert.doesNotMatch(projected.toString(), /\u001b|\ufffd/);
    assert.match(projected.toString(), /\[status text truncated\]/); assert.ok(projected.length < 4096);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(raw));
    assert.equal(stream.destroyed, false); assert.equal(stream.writableEnded, false); stream.end();
  } else {
    const chunks = [], stream = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    const original = Buffer.from(Array.from({ length: 256 }, (_, index) => index)), expected = Buffer.from(original);
    await withCheckoutMutation(root, async session => {
      const pending = writeBootstrapDiagnosticBytes(original, stream, { root, session }); original.fill(0); await pending;
    });
    assert.deepEqual(Buffer.concat(chunks), expected); assert.equal(stream.listenerCount('error'), 0); assert.equal(stream.listenerCount('close'), 0); stream.end();
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Bootstrap summaries preserve original domain failures, bounded human output and exact captured diagnostic bytes');
