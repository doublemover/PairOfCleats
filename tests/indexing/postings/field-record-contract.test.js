import assert from 'node:assert/strict';
import { buildPostings } from '../../../src/index/build/postings/index.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
for (const count of [0, 1]) {
  for (const field of ['__proto__', 'constructor', 'body']) {
    const lengths = count ? [3] : [];
    const fields = Object.fromEntries([[field, new Map(count ? [['word', [[0, 1]]]] : [])]]);
    const fieldLengths = Object.fromEntries([[field, lengths], ['toString', lengths]]);
    const prototype = Object.getPrototypeOf(fields), lengthsPrototype = Object.getPrototypeOf(fieldLengths);
    const output = await buildPostings({ chunks: count ? [{ tokens: ['word'], seq: ['word'] }] : [],
      tokenPostings: new Map(), docLengths: lengths, fieldPostings: fields, fieldDocLengths: fieldLengths,
      phrasePost: new Map(), triPost: new Map(), embeddingsEnabled: false,
      postingsConfig: { fielded: true, enableChargrams: false, enablePhraseNgrams: false } });
    const actual = output.fieldPostings.fields;
    assert.equal(Object.getPrototypeOf(actual), Object.prototype, 'field names cannot replace the output prototype');
    assert.equal(Object.getPrototypeOf(fields), prototype); assert.equal(Object.getPrototypeOf(fieldLengths), lengthsPrototype);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(actual))).sort(), [field, 'toString'].sort());
    for (const key of [field, 'toString']) {
      assert.ok(Object.hasOwn(actual, key), 'every declared own field survives even without postings');
      assert.deepEqual(actual[key].docLengths, lengths); assert.equal(actual[key].totalDocs, count);
      assert.equal(actual[key].avgDocLen, count ? 3 : 0);
      assert.deepEqual(actual[key].vocab, key === field && count ? ['word'] : []);
      assert.deepEqual(actual[key].postings, key === field && count ? [[[0, 1]]] : []);
    }
  }
}
console.log('Empty and populated postings preserve reserved and lengths-only field records.');
