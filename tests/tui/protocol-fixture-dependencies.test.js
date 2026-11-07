import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getTuiSupervisorCapabilities } from '../../src/shared/runtime-capability-manifest.js';
import { SUPERVISOR_CAPABILITIES } from '../../tools/tui/supervisor/constants.js';

assert.deepEqual(SUPERVISOR_CAPABILITIES, getTuiSupervisorCapabilities());
// The Rust job intentionally needs Node and Cargo, without an application npm
// install. Exercise its actual JS producers while refusing all package imports.
// This also guards the transport leaf against pulling the entire API surface in.
const hook = `import { registerHooks } from 'node:module';
registerHooks({resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('node:') && !specifier.startsWith('.') && !specifier.startsWith('/')
    && !specifier.startsWith('file:') && !specifier.startsWith('data:')) throw new Error('Unexpected protocol package dependency: ' + specifier);
  return nextResolve(specifier, context);
}});`;
for (const args of [['tests/helpers/tui/lifecycle-flow.js'], ['tests/helpers/tui/unicode-frames.js'],
  ['tests/helpers/tui/lifecycle-pressure-frames.js'], ['tests/helpers/tui/lifecycle-pressure-frames.js', 'loss']]) {
  const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(hook), ...args], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true
  });
  assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim(), args.join(' '));
  const frames = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.ok(frames.every(frame => frame.proto === 'poc.progress@2' || frame.event === 'fixture:expected'));
  assert.ok(frames.some(frame => frame.event === 'job:end' || frame.event === 'task:end'
    || frame.event === 'event:chunk' && ['job:end', 'task:end'].includes(frame.chunkEvent)));
}
console.log('Actual Rust protocol producers retain canonical capabilities without application package imports.');
