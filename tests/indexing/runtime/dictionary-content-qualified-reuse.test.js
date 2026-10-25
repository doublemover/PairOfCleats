import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveRuntimeDictionaries } from '../../../src/index/build/runtime/dictionaries.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('dictionary-qualified-reuse');
const dictDir = path.join(dir, 'dictionaries'), codeDir = path.join(dictDir, 'code-dicts', 'javascript');
await fs.mkdir(codeDir, { recursive: true });
const file = path.join(dictDir, 'combined.txt'), codeFile = path.join(codeDir, 'selected.txt');
await fs.writeFile(file, 'alpha\n'); await fs.writeFile(codeFile, 'callback\n');
const session = { dictCache: new Map() }, logs = [];
const options = { root: dir, userConfig: { dictionary: { dir: dictDir, languages: [], includeSlang: false,
  enableRepoDictionary: false }, indexing: { codeDictLanguages: ['javascript'] } },
workerPoolConfig: { enabled: true }, daemonSession: session, log: line => logs.push(line), logInit() {} };
const first = await resolveRuntimeDictionaries(options);
assert.ok(first.dictWords.has('alpha')); assert.ok(first.dictShared.has('alpha'));
first.dictWords.add('runtime-only'); new Uint8Array(first.dictSharedPayload.bytes).fill(0);
logs.length = 0;
const warm = await resolveRuntimeDictionaries(options);
assert.equal(warm.dictSignature, first.dictSignature); assert.ok(logs.some(line => line.includes('warm cache')));
assert.equal(warm.dictWords.has('runtime-only'), false); assert.ok(warm.dictShared.has('alpha'));
assert.equal(warm.dictSummary.inputs.complete, true); assert.equal(warm.dictSummary.inputs.failed, 0);
const before = await fs.stat(file); await fs.writeFile(file, 'bravo\n'); await fs.utimes(file, before.atime, before.mtime);
logs.length = 0;
const changed = await resolveRuntimeDictionaries(options);
assert.notEqual(changed.dictSignature, warm.dictSignature); assert.ok(changed.dictWords.has('bravo'));
assert.equal(changed.dictWords.has('alpha'), false); assert.ok(changed.dictShared.has('bravo'));
assert.equal(logs.some(line => line.includes('warm cache')), false);
session.dictCache.set(changed.dictSignature, { inputReceiptVersion: 1, inputIdentity: changed.dictSignature,
  dictWords: new Set(['forged']) });
const rejected = await resolveRuntimeDictionaries(options);
assert.equal(rejected.dictWords.has('forged'), false); assert.ok(rejected.dictWords.has('bravo'));
const originalOpen = fs.open, originalReaddir = fs.readdir, existing = [...session.dictCache.keys()];
const failure = Object.freeze(Object.assign(new Error('controlled dictionary refusal'), { code: 'EACCES' }));
try {
  fs.open = async (target, ...args) => { if (path.relative(String(target), file) === '') throw failure; return originalOpen.call(fs, target, ...args); };
  await assert.rejects(resolveRuntimeDictionaries(options), error => error === failure || error.cause === failure);
  assert.deepEqual([...session.dictCache.keys()], existing, 'failed revalidation cannot publish/replace a complete cache entry');
} finally { fs.open = originalOpen; }

const partialError = Object.freeze(Object.assign(new Error('controlled partial dictionary'), { code: 'EIO' }));
try {
  fs.open = async (target, ...args) => {
    const handle = await originalOpen.call(fs, target, ...args);
    if (path.relative(String(target), file) !== '') return handle;
    const read = handle.read; let calls = 0;
    handle.read = async function (buffer, offset, length, position) {
      if (calls++ === 0) return read.call(this, buffer, offset, Math.min(length, 6), position);
      throw partialError;
    };
    return handle;
  };
  await assert.rejects(resolveRuntimeDictionaries(options), error => error === partialError || error.cause === partialError);
  assert.deepEqual([...session.dictCache.keys()], existing, 'a partially parsed input cannot publish cache readiness');
} finally { fs.open = originalOpen; }
const restored = await resolveRuntimeDictionaries(options);
assert.ok(restored.dictWords.has('bravo')); assert.ok(restored.codeDictWordsByLanguage.get('javascript').has('callback'));
assert.ok(restored.dictShared.has('bravo'), 'successful re-acquisition restores worker and inline vocabulary together');

// Same selected bytes in a different semantic scope must not reuse the old
// language analyzer. Renames preserve content rather than inventing new words.
const commonFile = path.join(dictDir, 'code-dicts', 'common.txt');
await fs.rename(codeFile, commonFile);
const rescoped = await resolveRuntimeDictionaries(options);
assert.notEqual(rescoped.dictSignature, restored.dictSignature);
assert.ok(rescoped.codeDictCommonWords.has('callback'));
assert.equal(rescoped.codeDictWordsByLanguage.get('javascript')?.has('callback') ?? false, false);
try {
  fs.readdir = async (target, ...args) => {
    if (path.relative(String(target), path.dirname(commonFile)) === '') throw failure;
    return originalReaddir.call(fs, target, ...args);
  };
  await assert.rejects(resolveRuntimeDictionaries(options), error => error === failure || error.cause === failure,
    'denied directory selection cannot become an empty successful dictionary');
} finally { fs.readdir = originalReaddir; }
console.log('runtime dictionaries content-qualified reuse passed');
