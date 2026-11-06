import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runSetupCommand } from '../../../tools/setup/owned-command.js';
import { runCheckoutBootstrap } from '../../../tools/setup/checkout-bootstrap.js';
import { createNativeSetupDiagnostics } from '../../../tools/setup/native-diagnostics.js';
import { withCheckoutMutation } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_JOURNAL_STATUS } from '../../../tools/setup/checkout-stage-journal.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/checkout-command-evidence/')[1];
assert.ok(['real-command-bytes-and-terminal-status', 'late-cancellation-keeps-original-result',
  'spawn-error-keeps-original-packet', 'canonical-command-stage-owned-evidence'].includes(mode));
const root = await makeTempDir('checkout-command-evidence-');
try {
  if (mode === 'real-command-bytes-and-terminal-status') {
    await withCheckoutMutation(root, async session => {
      const diagnostics = createNativeSetupDiagnostics(root, session);
      const result = await runSetupCommand(process.execPath, ['--eval',
        'process.stdout.write(Buffer.from(Array.from({length:65536},(_,i)=>i%256)));process.stderr.write("actual stderr");process.exitCode=7;'],
      { cwd: root, stdio: 'pipe', windowsHide: true, timeoutMs: 5000 }, { diagnostics });
      assert.equal(result.ok, false); assert.equal(result.status, 7); assert.equal(result.signal, null);
      assert.equal(result.diagnostics.evidenceComplete, true); assert.equal(result.diagnostics.compiler.exitCode, 7);
      const bytes = Buffer.from(Array.from({ length: 65536 }, (_, index) => index % 256)), log = result.diagnostics.logs[0];
      assert.deepEqual(fs.readFileSync(log.path), bytes); assert.equal(log.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(fs.readFileSync(result.diagnostics.logs[1].path, 'utf8'), 'actual stderr');
      assert.ok(Buffer.byteLength(result.stdout) <= 4096); assert.equal(diagnostics.snapshot().attempts, 1);
    });
  } else if (mode === 'late-cancellation-keeps-original-result') {
    const controller = new AbortController(), original = Object.freeze(new Error('late original cancellation'));
    const actual = await withCheckoutMutation(root, session => runSetupCommand('explicit-fixture-completed-command', [],
      { cwd: root, stdio: 'pipe', signal: controller.signal }, { diagnostics: createNativeSetupDiagnostics(root, session),
        spawn: async (command, args, options) => {
          options.onStdoutChunk(Buffer.from('completed before cancellation')); controller.abort(original);
          return { exitCode: 0, signal: null };
        }
      })).catch(error => error);
    assert.equal(errorGraphIncludes(actual, original), true); assert.equal(actual.childResult.exitCode, 0);
    assert.equal(actual.childResult.diagnostics.evidenceComplete, true); assert.equal(actual.diagnosticsPath, actual.childResult.diagnosticsPath);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
  } else if (mode === 'spawn-error-keeps-original-packet') {
    let retired = false;
    const packet = Object.freeze({ exitCode: 7, signal: null, stdout: 'original child output', stderr: 'original child error' });
    const original = Object.freeze(Object.assign(new Error('original spawn owner failed'), { result: packet,
      cacheOwnershipPending: true, cacheOwnershipReleased: () => retired }));
    const actual = await runSetupCommand('explicit-fixture-spawn-error', [], {}, { spawn: async () => { throw original; } }).catch(error => error);
    assert.equal(errorGraphIncludes(actual, original), true); assert.equal(actual.childResult, packet);
    assert.equal(actual.cacheOwnershipReleased(), false); retired = true; assert.equal(actual.cacheOwnershipReleased(), true);
  } else {
    // Explicit fixture executables exercise the production frontdoor/child/log
    // path. No package manager, compiler, patcher or dependency install runs.
    const preflight = path.join(root, 'tools', 'setup', 'preflight.js'), npmFixture = path.join(root, 'fixture-npm.cjs');
    fs.mkdirSync(path.dirname(preflight), { recursive: true });
    fs.writeFileSync(preflight, 'process.stdout.write("explicit fixture preflight\\n");');
    fs.writeFileSync(npmFixture, 'process.stderr.write("explicit fixture locked-install failure\\n");process.exitCode=7;');
    const actual = await runCheckoutBootstrap(['locked'], { root, env: { npm_execpath: npmFixture },
      inspect: async () => ({ ready: false, reason: 'explicit fixture checkout' }),
      captureInputs: () => [['fixture-source', 'same-input']], progress: () => {}
    }).catch(error => error);
    assert.equal(actual.code, 'ERR_CHECKOUT_BOOTSTRAP_STAGE'); assert.equal(actual.stage, 'dependencies');
    assert.equal(actual.result.status, 7); assert.equal(actual.result.diagnostics.evidenceComplete, true);
    const status = JSON.parse(fs.readFileSync(path.join(root, CHECKOUT_JOURNAL_STATUS), 'utf8'));
    assert.equal(status.state, 'failed'); assert.deepEqual(status.stages.map(row => row.id), ['prerequisites', 'dependencies']);
    assert.deepEqual(status.stages.map(row => row.result.status), [0, 7]);
    for (const [index, row] of status.stages.entries()) {
      const record = JSON.parse(fs.readFileSync(row.result.diagnosticsPath, 'utf8'));
      assert.equal(record.runId, status.runId); assert.equal(record.command, process.execPath);
      assert.equal(record.args[0], index ? npmFixture : preflight); assert.equal(record.compiler.exitCode, index ? 7 : 0);
    }
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Checkout command evidence retains original bytes, command identity, exit status and late cancellation packets');
