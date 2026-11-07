import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSearchValidator } from '../../../tools/api/validation.js';
const require = createRequire(import.meta.url);
const { buildSearchArgs, buildSearchPayload, readSearchOptions } = require('../../../extensions/vscode/search-contract.js');
const validate = createSearchValidator();
for (const value of [0, 14, '0', '14', ' 14 ']) {
  const options = readSearchOptions({ get: key => key === 'modified' ? value : undefined }, { modifiedSinceKey: 'modified' });
  const payload = buildSearchPayload('needle', '/fixture', options);
  assert.equal(payload.modifiedSince, Number(value));
  assert.equal(validate(payload).ok, true);
  const args = buildSearchArgs('needle', '/fixture', options);
  assert.equal(args[args.indexOf('--modified-since') + 1], String(Number(value)));
}
for (const value of [undefined, null, '', ' ']) {
  assert.equal(Object.hasOwn(buildSearchPayload('needle', '/fixture', { modifiedSince: value }), 'modifiedSince'), false);
}
for (const value of [-1, '-1', 0.5, '0.5', '14 days', '1e2', Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, true, []]) {
  assert.throws(() => buildSearchArgs('needle', '/fixture', { modifiedSince: value }), /searchModifiedSince/);
  assert.throws(() => buildSearchPayload('needle', '/fixture', { modifiedSince: value }), /searchModifiedSince/);
}
console.log('VS Code modified-since encoding agrees with the canonical HTTP schema');
