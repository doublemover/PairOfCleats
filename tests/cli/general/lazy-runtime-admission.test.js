import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Writable } from 'node:stream';

const failures = new Map(['eslint', 'terminal-kit'].map(name => [name, Object.freeze(new Error(`Original ${name} activation failure`))]));
const requests = [];
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (failures.has(specifier)) { requests.push(specifier); throw failures.get(specifier); }
  return nextResolve(specifier, context);
} });
try {
  const { createDisplay } = await import('../../../src/shared/cli/display.js');
  const { createLintAnalyzer } = await import('../../../src/index/lint-runtime.js');
  assert.deepEqual(requests, [], 'importing the actual owners must not activate optional execution paths');
  let output = '';
  const stream = new Writable({ write(bytes, _encoding, callback) { output += bytes.toString(); callback(); } });
  for (const progressMode of ['off', 'log', 'jsonl']) {
    const display = createDisplay({ stream, isTTY: false, progressMode });
    display.log('original machine-output witness');
    await display.close();
  }
  assert.ok(output.includes('original machine-output witness'));
  const analyze = createLintAnalyzer(), source = 'export const answer = 42;\n';
  const disabled = await analyze(source, 'example.js', { root: process.cwd(), enabled: false });
  assert.equal(disabled.receipt.status, 'disabled');
  assert.equal(disabled.receipt.clean, false);
  assert.deepEqual(disabled.messages, []);
  const unsupported = await analyze('answer = 42\n', 'example.py', { root: process.cwd() });
  assert.equal(unsupported.receipt.status, 'unsupported');
  assert.deepEqual(requests, [], 'noninteractive, disabled and unsupported work admits no vendor runtime');
  const failed = await analyze(source, 'example.js', { root: process.cwd() });
  assert.equal(failed.receipt.status, 'unavailable');
  assert.equal(failed.receipt.reason, 'runtime-initialization-failed');
  assert.equal(failed.error, failures.get('eslint'), 'the original admitted activation failure remains visible');
  assert.throws(() => createDisplay({ stream, isTTY: true, progressMode: 'tty' }), error => error === failures.get('terminal-kit'));
  assert.deepEqual(requests, ['eslint', 'terminal-kit'], 'actual admitted paths still activate their original vendors');
} finally { hook.deregister(); }
console.log('Noninteractive output and inactive lint avoid vendor activation; actual activation retains original failures.');
