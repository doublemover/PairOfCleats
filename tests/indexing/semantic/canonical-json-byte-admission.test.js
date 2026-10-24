import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { encodeSemanticEvidence, persistSemanticEvidence } from '../../../src/index/semantic/lsp-evidence.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';

// Authored only. Canonical representation and the real sidecar/account owner.
const values = [null, false, true, 0, 0.125, 1e30, '', 'ASCII', 'é名😀', '\ud800', '\udfff',
  '"\\\b\t\n\f\r\u0000\u001f', [], {}, { z: [], a: { '名😀': ['a', null, 12] } },
  JSON.parse('{"__proto__":{"keep":true},"2":2,"10":10,"a":"x"}')];
for (const value of values) {
  const expected = canonicalSemanticJson(value), maxBytes = Buffer.byteLength(expected);
  assert.equal(canonicalSemanticJson(value, { maxBytes }), expected);
  if (maxBytes > 1) assert.throws(() => canonicalSemanticJson(value, { maxBytes: maxBytes - 1 }), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
}
const captured = [], nested = { a: [{ b: 2 }], z: false };
canonicalSemanticJson(nested, { maxBytes: 1024, onObjectEncoded: (item, encoded) => captured.push([item, encoded]) });
assert.deepEqual(captured.map(([item, encoded]) => [item === nested, encoded]), [
  [false, '{"b":2}'], [false, '[{"b":2}]'], [true, '{"a":[{"b":2}],"z":false}']
]);
let getterCalls = 0;
const getter = {};
Object.defineProperty(getter, 'payload', { enumerable: true, get() { getterCalls++; return 'unexpected'; } });
for (const invalid of [undefined, NaN, Infinity, -0, 1n, () => null, new Date(), getter, new Array(1), Object.assign([], { extra: true })]) {
  assert.throws(() => canonicalSemanticJson(invalid, { maxBytes: 1024 }), TypeError);
}
const cycle = []; cycle.push(cycle);
assert.throws(() => canonicalSemanticJson(cycle, { maxBytes: 1024 }), /cycles/);
assert.equal(getterCalls, 0);
assert.throws(() => canonicalSemanticJson('x'.repeat(100000), { maxBytes: 32 }), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
let enumerations = 0;
const oversizedArray = new Proxy(new Array(100000), { ownKeys() { enumerations++; throw new Error('must reject its minimum encoded size first'); } });
assert.throws(() => canonicalSemanticJson(oversizedArray, { maxBytes: 32 }), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
assert.equal(enumerations, 0, 'a huge array length fails before enumeration or a proportional key array');
let deep = null;
for (let depth = 0; depth < 10000; depth++) deep = [deep];
const deepEncoded = canonicalSemanticJson(deep, { maxBytes: 20004 });
assert.equal(deepEncoded.length, 20004, 'bounded encoding does not borrow the JavaScript call stack');
const interrupted = new Error('encoding canceled');
assert.throws(() => canonicalSemanticJson(nested, { maxBytes: 1024, check() { throw interrupted; } }), error => error === interrupted);
assert.throws(() => encodeSemanticEvidence({ payload: 'x'.repeat(100) }, { maxBytes: 32 }), { code: 'ERR_SEMANTIC_EVIDENCE_BUDGET' });

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-bounded-evidence-'));
try {
  const inventory = [], account = createSemanticDiskAccount(4096), value = { payload: '名😀' };
  const encoded = canonicalSemanticJson(value), maxBytes = Buffer.byteLength(encoded);
  await assert.rejects(persistSemanticEvidence({ value, stagingRoot: root, diskAccount: account, inventory, maxBytes: maxBytes - 1 }),
    { code: 'ERR_SEMANTIC_EVIDENCE_BUDGET' });
  assert.deepEqual(inventory, []);
  assert.deepEqual(await fs.readdir(root), [], 'rejected encoding cannot create evidence files');
  const artifact = await persistSemanticEvidence({ value, stagingRoot: root, diskAccount: account, inventory, maxBytes });
  assert.equal(await fs.readFile(path.join(root, artifact), 'utf8'), encoded);
  assert.equal(inventory[0].bytes, maxBytes);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('canonical semantic JSON and evidence charge exact UTF8 bytes before encoded expansion');
