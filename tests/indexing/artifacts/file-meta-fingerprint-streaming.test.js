import assert from 'node:assert/strict';
import { computeFileMetaFingerprint } from '../../../src/index/build/artifacts/file-meta.js';
import { sha1 } from '../../../src/shared/hash.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';

// Preserve the previous owner as a compatibility oracle, including its source
// getter order, signature canonicalization and JSON array-hole behavior.
const materializedFingerprint = ({ files, fileInfoByPath }) => {
  const list = files.map((file) => {
    const info = fileInfoByPath?.get?.(file) || null;
    return {
      file,
      size: Number.isFinite(info?.size) ? info.size : null,
      hash: info?.hash || null,
      hashAlgo: info?.hashAlgo || null
    };
  });
  return sha1(stableStringifyForSignature(list));
};

const values = [null, undefined, '', 'sha1', 'é中👩🏽‍💻', '"\\\n', '\ud800', 0, -0, 3, NaN, Infinity, false, true];
let parityCases = 0;
for (const file of values) {
  for (const hash of values) {
    const input = {
      files: [file, 'normal.js'],
      fileInfoByPath: new Map([[file, { size: hash, hash, hashAlgo: file }]])
    };
    assert.equal(computeFileMetaFingerprint(input), materializedFingerprint(input));
    parityCases += 1;
  }
}
for (const files of [[], ['missing.js'], new Array(4), [, 'middle.js', , 'last.js']]) {
  const input = { files, fileInfoByPath: new Map() };
  assert.equal(computeFileMetaFingerprint(input), materializedFingerprint(input));
  parityCases += 1;
}

const runObservableFixture = (fingerprint) => {
  const observations = [];
  const files = ['first.js', 'second.js'];
  const custom = { toJSON(key) { observations.push(`json:${key}`); return 'custom'; } };
  const fileInfoByPath = {
    get(file) {
      observations.push(`get:${file}`);
      return {
        get size() { observations.push(`size:${file}`); return 7; },
        get hash() { observations.push(`hash:${file}`); return custom; },
        get hashAlgo() { observations.push(`algo:${file}`); return 'sha1'; }
      };
    }
  };
  return { digest: fingerprint({ files, fileInfoByPath }), observations };
};
assert.deepEqual(runObservableFixture(computeFileMetaFingerprint), runObservableFixture(materializedFingerprint));

for (const complex of [2n, new Set(['b', 'a']), new Map([['b', 2], ['a', 1]]), /a+/gi, new Date(0), { nested: 1 }]) {
  const input = { files: ['complex.js'], fileInfoByPath: new Map([['complex.js', { hash: complex }]]) };
  assert.equal(computeFileMetaFingerprint(input), materializedFingerprint(input));
}
class FileList extends Array {}
for (const files of [new FileList('a.js', 'b.js'), { map: (callback) => [callback('a.js'), callback('b.js')] }]) {
  const input = { files, fileInfoByPath: new Map() };
  assert.equal(computeFileMetaFingerprint(input), materializedFingerprint(input));
}

// A getter whose second size read changes type must use the old fallback.
const runChangingSize = (fingerprint) => {
  let reads = 0;
  const info = { get size() { reads += 1; return reads === 1 ? 4 : { unexpected: 1 }; } };
  return { digest: fingerprint({ files: ['a.js'], fileInfoByPath: new Map([['a.js', info]]) }), reads };
};
assert.deepEqual(runChangingSize(computeFileMetaFingerprint), runChangingSize(materializedFingerprint));

const runCustomArray = (fingerprint, useProxy) => {
  const observations = [];
  const source = ['a.js', 'b.js'];
  Object.defineProperty(source, 'map', {
    get() { observations.push('map'); return Array.prototype.map; }
  });
  const files = useProxy ? new Proxy(source, {
    getPrototypeOf(target) { observations.push('prototype'); return Reflect.getPrototypeOf(target); }
  }) : source;
  return { digest: fingerprint({ files, fileInfoByPath: new Map() }), observations };
};
for (const useProxy of [false, true]) {
  assert.deepEqual(runCustomArray(computeFileMetaFingerprint, useProxy), runCustomArray(materializedFingerprint, useProxy));
}

const files = Array.from({ length: 64 }, (_, i) => `src/é中-${i}-` + 'name'.repeat(64) + '.js');
const input = { files, fileInfoByPath: new Map(files.map((file, i) => [file, { size: i, hash: `hash-${i}`, hashAlgo: 'sha1' }])) };
const observeSerialization = (fingerprint) => {
  const stringify = JSON.stringify;
  let arraySerializations = 0;
  let widestString = 0;
  JSON.stringify = function(value, ...rest) {
    if (Array.isArray(value)) arraySerializations += 1;
    const output = stringify.call(this, value, ...rest);
    if (typeof output === 'string') widestString = Math.max(widestString, output.length);
    return output;
  };
  try { return { digest: fingerprint(input), arraySerializations, widestString }; }
  finally { JSON.stringify = stringify; }
};
const before = observeSerialization(materializedFingerprint);
const after = observeSerialization(computeFileMetaFingerprint);
assert.equal(after.digest, before.digest);
assert.equal(before.arraySerializations, 1);
assert.equal(after.arraySerializations, 0);
assert.ok(after.widestString < before.widestString / 32);
console.log(`file-meta fingerprint streaming passed: ${parityCases} primitive/sparse parity cases; whole-array serialization1→0, widest JSON string ${before.widestString}→${after.widestString} UTF16 units`);
