import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteText } from '../../../src/shared/io/atomic-write.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('atomic-exclusive-write');
const target = path.join(dir, 'export.bin'), bytes = Buffer.from([0, 1, 128, 255]);
const options = { mkdir: false, createOnly: true, newline: false };
const noTemps = async () => assert.deepEqual((await fs.readdir(dir)).filter(name => name.includes('.tmp-')), []);
await atomicWriteText(target, bytes, options);
assert.deepEqual(await fs.readFile(target), bytes);
await assert.rejects(atomicWriteText(target, 'replacement', options), error => error.causeCode === 'EEXIST');
assert.deepEqual(await fs.readFile(target), bytes);
await noTemps();
await fs.unlink(target);

let staged = false;
await assert.rejects(atomicWriteText(target, bytes, { ...options, verifyStaging: async handle => {
  staged = true; assert.equal((await handle.stat()).size, 0);
  throw Object.assign(new Error('Reject before writing payload'), { code: 'FIXTURE_REJECT' });
} }), error => error.causeCode === 'FIXTURE_REJECT');
assert.equal(staged, true); await noTemps();
await assert.rejects(fs.stat(target), { code: 'ENOENT' });
const abort = new AbortController();
await assert.rejects(atomicWriteText(target, bytes, { ...options, signal: abort.signal,
  beforeCommit: () => abort.abort() }), { name: 'AbortError' });
await assert.rejects(fs.stat(target), { code: 'ENOENT' }); await noTemps();

// An actual concurrent creator wins. A preflight exists check would lose here.
const link = fs.link;
fs.link = async (from, to) => { await fs.writeFile(to, 'concurrent creator'); return link(from, to); };
try { await assert.rejects(atomicWriteText(target, bytes, options), error => error.causeCode === 'EEXIST'); }
finally { fs.link = link; }
assert.equal(await fs.readFile(target, 'utf8'), 'concurrent creator'); await noTemps();
console.log('atomic exclusive write passed');
