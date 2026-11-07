import assert from 'node:assert/strict';
import { unionBitmaps } from '../../../src/retrieval/bitmap.js';
import { createTopKReducer } from '../../../src/retrieval/pipeline/topk.js';
import { createScoreBufferPool } from '../../../src/retrieval/pipeline/score-buffer.js';
import { normalizeAsOfInput } from '../../../src/index/as-of.js';
import { resolveBackendPolicy } from '../../../src/storage/backend-policy.js';
class Bitmap extends Set {
  clone() { return new Bitmap(this); }
  orInPlace(other) { for (const id of other) this.add(id); }
}
const a = new Bitmap([1]), b = new Bitmap([2]);
assert.deepEqual([...unionBitmaps([null, a, null, b])], [1, 2]);
assert.deepEqual([...a], [1]);
assert.equal(unionBitmaps([null, null]), null);
const top = createTopKReducer({ k: 3 });
top.pushRaw(2, 1, 0);
assert.deepEqual(top.finish({ limit: 0 }), []);
assert.equal(top.finish({ limit: 1 }).length, 1);
const pool = createScoreBufferPool();
const fields = ['a|b'];
const one = pool.acquire({ fields, numericFields: ['a|b'], capacity: 1 });
one.push({ 'a|b': 7 });
fields.push('later');
pool.release(one);
const two = pool.acquire({ fields: ['a', 'b'], numericFields: ['a', 'b'], capacity: 1 });
assert.notEqual(one, two, 'delimiter-containing schemas cannot share a pooled entry shape');
assert.equal(two.push({ a: 2, b: 3 }).b, 3);
assert.deepEqual(one.fields, ['a|b'], 'pool schema identity does not borrow caller arrays');
for (const value of ['', ' ', 0, false, {}, []]) {
  assert.throws(() => normalizeAsOfInput({ asOf: value }), { code: 'INVALID_REQUEST' });
  assert.throws(() => normalizeAsOfInput({ snapshot: value }), { code: 'INVALID_REQUEST' });
}
assert.equal(normalizeAsOfInput({ asOf: null }).provided, false);
assert.equal(normalizeAsOfInput({ asOf: ' latest ' }).inputRef, 'latest');
for (const backendArg of ['sqlite', 'sqlite-fts', 'fts']) {
  assert.equal(resolveBackendPolicy({ backendArg, needsSqlite: false }).backendForcedSqlite, true);
}
console.log('Ranking boundary values retain exact identities and explicit backend intent.');
