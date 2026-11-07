import assert from 'node:assert/strict';
import { validationErrorMetadata } from '../../../src/index/validate/issues.js';

let settled = false, observer = () => settled;
const original = new Error('original native closure remains pending');
Object.defineProperties(original, { cacheOwnershipPending: { value: true },
  cacheOwnershipReleased: { get: () => observer } });
let retained;
assert.throws(() => validationErrorMetadata(original, 'sqlite'), error => { retained = error; return true; });
observer = () => true;
assert.throws(() => validationErrorMetadata(retained, 'sqlite'), 'report callback replacement cannot classify unconfirmed native closure as an ordinary finding');
settled = true;
assert.equal(retained.cacheOwnershipReleased(), true);
assert.deepEqual(validationErrorMetadata(Object.assign(new Error('missing source'), { code: 'ENOENT' }), 'chunk_meta'),
  { artifact: 'chunk_meta', code: 'ENOENT', state: 'missing' });
console.log('Validation propagates original unsettled resource ownership before ordinary finding classification.');
