import assert from 'node:assert/strict';
import { hydrateSearchIndexPostProcessing } from '../../src/retrieval/index-hydration.js';

const hydrate = (vocab) => {
  const artifact = { vocab };
  hydrateSearchIndexPostProcessing({ phraseNgrams: artifact }, { includeFilterIndex: false });
  return artifact.vocabIndex;
};
const legacy = (vocab) => new Map(vocab.map((term, index) => [term, index]));

const objectTerm = {};
for (const vocab of [[], ['a'], ['a', 'b', 'a'], [undefined, null, '', 0, -0, NaN, objectTerm, objectTerm]]) {
  assert.deepEqual([...hydrate(vocab)], [...legacy(vocab)]);
}
const existing = new Map([['existing', 6]]);
const populated = { vocab: ['new'], vocabIndex: existing };
hydrateSearchIndexPostProcessing({ chargrams: populated }, { includeFilterIndex: false });
assert.equal(populated.vocabIndex, existing);

const runObservable = (build, mutation = false) => {
  const observations = [];
  const vocab = ['initial', 'last'];
  Object.defineProperty(vocab, 0, {
    enumerable: true,
    get() {
      observations.push('read:0');
      if (mutation) vocab.push('ignored-after-captured-length');
      return 'first';
    }
  });
  Object.defineProperty(vocab, 1, {
    enumerable: true,
    get() { observations.push('read:1'); return 'last'; }
  });
  return { entries: [...build(vocab)], observations };
};
for (const mutation of [false, true]) {
  assert.deepEqual(runObservable(hydrate, mutation), runObservable(legacy, mutation));
}

const runSparse = (build) => {
  const observations = [];
  const vocab = new Array(3);
  Object.defineProperty(vocab, 2, {
    enumerable: true,
    get() { observations.push('read-after-hole'); return 'last'; }
  });
  try { build(vocab); assert.fail('sparse vocabulary must reject'); }
  catch (error) { return { name: error.name, message: error.message, observations }; }
};
assert.deepEqual(runSparse(hydrate), runSparse(legacy));
const sparseArtifact = { vocab: new Array(2) };
assert.throws(() => hydrateSearchIndexPostProcessing({ chargrams: sparseArtifact }, { includeFilterIndex: false }), TypeError);
assert.equal(Object.hasOwn(sparseArtifact, 'vocabIndex'), false);

class Vocabulary extends Array {}
const custom = ['a', 'b'];
custom.map = () => [['custom', 42]];
for (const vocab of [new Vocabulary('a', 'b'), custom, { map: () => [['object', 7]] }, new Proxy(['a', 'b'], {})]) {
  assert.deepEqual([...hydrate(vocab)], [...legacy(vocab)]);
}

const NativeMap = Map;
let suppliedRows = 0;
globalThis.Map = class ObservedMap extends NativeMap {
  constructor(entries) {
    if (Array.isArray(entries)) suppliedRows += entries.length;
    super(entries);
  }
};
let before;
let after;
try {
  const vocab = Array.from({ length: 128 }, (_, i) => `term-${i}`);
  const baseline = legacy(vocab);
  before = suppliedRows;
  suppliedRows = 0;
  const idx = {
    phraseNgrams: { vocab }, chargrams: { vocab },
    fieldPostings: { fields: { file: { vocab }, symbol: { vocab } } }
  };
  hydrateSearchIndexPostProcessing(idx, { includeFilterIndex: false });
  after = suppliedRows;
  for (const artifact of [idx.phraseNgrams, idx.chargrams, ...Object.values(idx.fieldPostings.fields)]) {
    assert.deepEqual([...artifact.vocabIndex], [...baseline]);
  }
} finally { globalThis.Map = NativeMap; }
assert.equal(before, 128);
assert.equal(after, 0);
console.log('index hydration vocabulary allocation passed: mapped pair rows128 per artifact→0; existing maps, duplicate keys, sparse rejection, captured length and custom routes preserved');
