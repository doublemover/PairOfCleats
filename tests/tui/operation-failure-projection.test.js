import assert from 'node:assert/strict';
import { TUI_OPERATION_FAILURES as catalog } from '../../src/contracts/tui-operation-failures.js';
import { TUI_OPERATION_FAILURE_SCHEMA } from '../../src/contracts/schemas/tui-operation-failure.js';
import { compileSchema, createAjv } from '../../src/shared/validation/ajv-factory.js';
import { projectTuiOperationFailure, readTuiSearchChildFailure, tuiFailureCode,
  getTuiFailureInspections } from '../../tools/tui/operator/operation-failure.js';

const validate = compileSchema(createAjv({ strict: true }), TUI_OPERATION_FAILURE_SCHEMA);
const secret = '\x1b[31msecret C:\\private\\config ' + 'x'.repeat(1024 * 1024);
for (const [code, reason] of Object.entries(catalog.codes)) {
  const projection = projectTuiOperationFailure(Object.assign(Error(secret), { code }));
  assert.equal(projection.reason, reason);
  assert.equal(validate(projection), true, JSON.stringify(validate.errors));
  assert.equal(JSON.stringify(projection).includes('secret'), false);
  assert.deepEqual(projection.actions, catalog.reasons[reason].actions);
  assert.equal(validate({ ...projection, actions: ['retry', 'refresh-status'] }), false);
}
for (const error of [undefined, null, 0, false, secret, { code: secret }, { code: 'PRIVATE_TOKEN' }]) {
  const projection = projectTuiOperationFailure(error);
  assert.equal(projection.reason, 'unknown');
  assert.equal(tuiFailureCode(error).code, 'ERR_TUI_OPERATION_FAILED');
}
let getterCalls = 0;
const accessor = Object.defineProperty({}, 'code', { get() { getterCalls++; throw Error(secret); } });
assert.equal(projectTuiOperationFailure(accessor).reason, 'unknown');
assert.equal(getterCalls, 0);
const inspection = Object.assign(Error('original observer'), { cacheOwnershipPending: true, cacheOwnershipReleased: () => false });
const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw inspection; } });
const observed = projectTuiOperationFailure(proxy);
assert.ok(getTuiFailureInspections(observed).includes(inspection));
assert.equal(observed.reason, 'unknown');
assert.equal(projectTuiOperationFailure({}, { diagnosticId: { toString() { assert.fail('must not coerce'); } } }).reason, 'unknown');
const pending = projectTuiOperationFailure({ code: 'NO_INDEX' }, { resourcePending: true, timedOut: true, cancelled: true });
assert.equal(pending.reason, 'resource-pending');
assert.ok(!pending.actions.includes('retry'));
assert.equal(projectTuiOperationFailure({}, { timedOut: true, cancelled: true }).reason, 'timeout');
assert.equal(projectTuiOperationFailure({}, { cancelled: true }).reason, 'cancelled');
const envelope = (text, outputCapture = {}) => ({ result: { stdout: text, stderr: secret, outputCapture } });
const safe = JSON.stringify({ ok: false, code: 'NO_INDEX', field: 'query', message: secret.slice(0, 2048) });
assert.equal(readTuiSearchChildFailure(envelope(JSON.stringify({ ok: false, code: 'NO_INDEX', message: secret }))).code, null,
  'an oversized malicious envelope cannot own a cause even when its code is known');
assert.equal(readTuiSearchChildFailure(envelope(safe)).code, 'NO_INDEX');
assert.equal(readTuiSearchChildFailure(envelope(safe)).field, 'query');
for (const outputCapture of [{ stdout: { truncated: true } }, { stdout: { encodingLoss: true } }]) {
  assert.equal(readTuiSearchChildFailure(envelope(safe, outputCapture)).code, null);
}
for (const value of ['NO_INDEX: ' + secret, JSON.stringify({ ok: true, code: 'NO_INDEX' }),
  JSON.stringify({ ok: false, code: 'PRIVATE_TOKEN' }), safe + '\ntrailer', secret]) {
  assert.equal(readTuiSearchChildFailure(envelope(value)).code, null);
}
assert.equal(readTuiSearchChildFailure({ result: { stderr: safe } }).code, 'NO_INDEX');
assert.equal(readTuiSearchChildFailure({ result: { exitCode: 3221225477 } }).nativeFailure, true);
assert.equal(readTuiSearchChildFailure({ result: { exitCode: 1 } }).nativeFailure, false);
console.log('Closed TUI failure projections preserve privacy, known causes and original inspection errors');
