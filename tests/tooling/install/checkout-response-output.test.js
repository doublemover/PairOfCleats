import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { writeCheckoutBootstrapResult } from '../../../tools/setup/checkout-bootstrap.js';
import { writeBootstrapText } from '../../../tools/setup/task-progress-output.js';
import { withCheckoutMutation } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { makeTempDir } from '../../helpers/temp.js';
import { isProcessAlive } from '../../../src/shared/locks/file-lock-owner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { copyBootstrapMetadataSources } from '../../helpers/bootstrap-metadata-sources.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/checkout-response-output/')[1];
assert.ok(['large-json-and-help-byte-parity', 'original-full-text-scope-and-provider', 'closed-stdout-cli-failure'].includes(mode));
if (mode === 'large-json-and-help-byte-parity') {
  const chunks = [], stream = new Writable({ highWaterMark: 1, write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const result = Object.freeze({ kind: 'explicit-metadata-fixture', text: 'é🤓\u001b'.repeat(12000), exitCode: 0 });
  await writeCheckoutBootstrapResult(result, { json: true, mode: 'plan' }, { stdout: stream });
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(JSON.stringify(result) + '\n'));
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), result); assert.ok(chunks.length > 8);
  chunks.length = 0;
  const help = 'First line\nSecond line with é🤓\n';
  await writeCheckoutBootstrapResult({ text: help }, { json: false, mode: 'help' }, { stderr: stream });
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(help + '\n'));
  assert.equal(stream.destroyed, false); assert.equal(stream.writableEnded, false);
  assert.equal(stream.listenerCount('error'), 0); assert.equal(stream.listenerCount('close'), 0); stream.end();
} else if (mode === 'original-full-text-scope-and-provider') {
  const root = await makeTempDir('bootstrap-text-scope-'), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const chunks = []; let complete, calls = 0, outputOutcome, rootOutcome, returned = false;
  const stream = new Writable({ write(chunk, encoding, callback) {
    chunks.push(Buffer.from(chunk)); if (++calls === 1) { complete = callback; entered.resolve(); } else callback();
  } });
  try {
    rootOutcome = withCheckoutMutation(root, async session => {
      const context = { root, session }, pending = writeBootstrapText('é🤓'.repeat(6000), stream, context);
      outputOutcome = pending.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
      outputOutcome.then(outcome => { if (!complete) entered.reject(outcome.error || new Error('Output returned without admitting the first chunk.')); });
      stream.write = () => assert.fail('caller replaced the original full-text output provider'); context.root = 'changed-root'; context.session = {};
      await entered.promise; await release.promise;
    }).then(value => { returned = true; return { ok: true, value }; }, error => { returned = true; return { ok: false, error }; });
    await entered.promise; release.resolve();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(returned, false);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
    const finish = complete; complete = null; finish();
    const [outer, inner] = await Promise.all([rootOutcome, outputOutcome]);
    assert.equal(outer.ok, false); assert.equal(inner.ok, false, 'an early returning parent cannot continue new chunk admission after entering drain');
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
    assert.ok(Buffer.concat(chunks).length > 0); assert.ok(Buffer.concat(chunks).length < Buffer.byteLength('é🤓'.repeat(6000)));
  } finally {
    release.resolve(); if (complete) complete();
    await Promise.allSettled([rootOutcome, outputOutcome].filter(Boolean));
    stream.end(); fs.rmSync(root, { recursive: true, force: true });
  }
} else {
  const root = await makeTempDir('checkout-response-pipe-');
  copyBootstrapMetadataSources(process.cwd(), root, ['tools/setup/checkout-bootstrap.js']);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const child = spawn(process.execPath, [path.join(root, 'tools/setup/checkout-bootstrap.js'), 'locked', '--help', '--json'], {
    cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  const stderr = []; let bytes = 0, timedOut = false;
  child.stderr.on('data', chunk => { bytes += chunk.length; assert.ok(bytes <= 65536); stderr.push(chunk); });
  const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 12000);
  child.stdout.destroy();
  try {
    const result = await completed, text = Buffer.concat(stderr).toString('utf8');
    assert.equal(timedOut, false); assert.deepEqual(result, { code: 1, signal: null });
    assert.match(text, /Bootstrap status transport failed/); assert.doesNotMatch(text, /Unhandled|uncaught|triggerUncaughtException/);
    assert.equal(isProcessAlive(child.pid), false);
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), false); assert.equal(fs.existsSync(path.join(root, '.tmp')), false);
  } finally { clearTimeout(timeout); fs.rmSync(root, { recursive: true, force: true }); }
}
console.log('Checkout metadata/help keeps exact bytes and reports actual stdout delivery failure with bounded owned writes');
