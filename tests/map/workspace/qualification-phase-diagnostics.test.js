#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachQualificationDiagnostics, classifyQualificationPhase } from './qualification-diagnostics.js';
const page = new EventEmitter(); page.url = () => 'https://localhost/viewer';
const receipt = {};
const diagnostics = attachQualificationDiagnostics(page, receipt, 'workspace');
diagnostics.begin('three');
page.emit('pageerror', new Error('late render failure'));
assert.throws(() => diagnostics.assertClean(), /late render failure/);
assert.equal(receipt.phases[1].status, 'failed');
for (const type of ['console', 'http', 'pageerror']) {
  const event = { type, url: 'https://localhost/module.js', message: type === 'console' ? 'Shader compilation failed' : 'unexpected', status: type === 'http' ? 404 : undefined };
  assert.equal(classifyQualificationPhase({ events: [event], expected: [], overflow: 0 }).ok, false);
}
const expected = { type: 'console', message: 'THREE.WebGLRenderer: Error creating WebGL context.', maxCount: 1 };
const intentional = { events: [{ type: 'console', message: expected.message }], expected: [expected], overflow: 0 };
assert.equal(classifyQualificationPhase(intentional).ok, true);
assert.equal(classifyQualificationPhase({ ...intentional, events: [...intentional.events, { type: 'pageerror', message: 'unrelated fallback failure' }] }).ok, false);
assert.equal(classifyQualificationPhase({ events: [], expected: [], overflow: 1 }).ok, false);
