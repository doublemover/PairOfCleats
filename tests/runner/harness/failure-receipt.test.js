import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTests } from '../run-execution.js';
import { buildFailureReceipt, redactRunnerArguments } from '../failure-receipt.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-failure-receipt-'));
try {
  const logs = path.join(root, 'logs'); await fs.mkdir(logs);
  const script = path.join(root, 'child.mjs');
  await fs.writeFile(script, 'process.stdout.write("child stdout\\n"); process.stderr.write("[cleanup] fixture.destroy start\\n"); process.exit(23);');
  const test = { id: 'fixture-failure', path: script, relPath: 'child.mjs' };
  const context = { jobs: 1, root, baseEnv: process.env, passThrough: ['--token', 'must-not-appear'], timeoutMs: 5000,
    captureOutput: true, retries: 0, runLogDir: logs, timeoutGraceMs: 100, skipExitCode: 77, maxOutputBytes: 4096, redoExitCodes: [] };
  const [result] = await runTests({ selection: [test], context });
  assert.equal(result.exitCode, 23);
  const receiptPath = result.logs.find(filename => filename.endsWith('.failure.json'));
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(receipt.outcome.rawExitStatus, 23);
  assert.equal(receipt.outcome.hex, '0x00000017');
  assert.equal(receipt.outcome.statusSource, 'test-process-close-event');
  assert.equal(receipt.outcome.spawnError, null);
  assert.equal(receipt.invocation.runtime.node, process.version);
  assert.equal(receipt.invocation.executable, process.execPath);
  assert.ok(receipt.process.childPid > 0);
  assert.ok(Date.parse(receipt.process.endedAt) >= Date.parse(receipt.process.startedAt));
  assert.equal(receipt.phase.crashPhase, 'unknown');
  assert.match(receipt.phase.lastObservedMarker.line, /fixture.destroy start/);
  assert.equal(receipt.invocation.arguments.at(-1), '[REDACTED]');
  assert.ok(!(await fs.readFile(receiptPath, 'utf8')).includes('must-not-appear'));
  assert.match(await fs.readFile(receipt.output.logPath, 'utf8'), /child stdout/);
  const raw = buildFailureReceipt({ test, attempt: 1, result: { ...result, exitCode: 3221225477 }, logPath: receipt.output.logPath });
  assert.equal(raw.outcome.hex, '0xC0000005'); assert.equal(raw.outcome.signedDecimal, -1073741819);
  const [spawnFailure] = await runTests({ selection: [{ ...test, id: 'fixture-spawn-error' }], context: { ...context, root: path.join(root, 'missing') } });
  const failed = JSON.parse(await fs.readFile(spawnFailure.logs.find(filename => filename.endsWith('.failure.json')), 'utf8'));
  assert.equal(failed.outcome.rawExitStatus, null);
  assert.equal(failed.outcome.spawnError.code, 'ENOENT');
  assert.equal(failed.outcome.statusSource, 'test-process-spawn-error');
  assert.deepEqual(redactRunnerArguments(['--password=x', 'https://user:pass@example.org/?token=y']).values,
    ['--password=[REDACTED]', 'https://[REDACTED]@example.org/?token=[REDACTED]']);
  console.log('Parent failure receipts preserve status, output, timestamps, provenance and redacted arguments.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
