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
const closingPage = new EventEmitter(); closingPage.url = () => 'https://localhost/fallback';
const closingReceipt = {}, closing = attachQualificationDiagnostics(closingPage, closingReceipt, 'fallback');
closing.assertClean(); assert.equal(closing.phase.status, 'passed');
closingPage.emit('pageerror', new Error('failure after prior clean observation'));
assert.equal(closing.phase.status, 'running', 'late callbacks revoke provisional success before final receipt publication');
assert.throws(() => closing.assertClean(), /failure after prior clean observation/u);
assert.equal(closing.phase.status, 'failed');
const scopedPage = new EventEmitter(); scopedPage.url = () => 'https://localhost/viewer';
const scoped = attachQualificationDiagnostics(scopedPage, {}, 'injected-no-webgl');
scoped.expect(expected);
scopedPage.emit('console', { type: () => 'error', location: () => ({}), text: () => expected.message });
scoped.begin('ordinary-three-retry');
scopedPage.emit('console', { type: () => 'error', location: () => ({}), text: () => expected.message });
assert.throws(() => scoped.assertClean(), /unexpected errors/u, 'an injected-step exception is not a retry-page allowlist');

const cancellation = { type: 'requestfailed', url: 'https://localhost/map-snapshot',
  method: 'POST', requestKind: 'files', requestId: 7, message: 'net::ERR_ABORTED', maxCount: 1 };
const matchesCancellation = event => classifyQualificationPhase({ events: [event], expected: [cancellation], overflow: 0 }).ok;
assert.equal(matchesCancellation({ ...cancellation }), true);
for (const changed of [{ requestKind: 'detail' }, { requestId: 8 }, { method: 'GET' },
  { url: 'https://localhost/module.js' }, { message: 'net::ERR_FAILED' }]) {
  assert.equal(matchesCancellation({ ...cancellation, ...changed }), false);
}
assert.equal(classifyQualificationPhase({ events: [{ ...cancellation }, { ...cancellation }],
  expected: [cancellation], overflow: 0 }).ok, false, 'only one exact owned cancellation is admitted');
