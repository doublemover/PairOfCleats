// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { inspectReusableDictionary, sameReusableDictionary } from '../../../tools/download/dictionary-reuse.js';

const root = await makeTempDir('dictionary-reuse-identity-');
try {
  const file = path.join(root, 'selected.txt');
  const source = Buffer.from('alpha\nbeta');
  const expectedHash = createHash('sha256').update(source).digest('hex');
  const options = { root, file, maxBytes: source.length, expectedHash };
  assert.equal(await inspectReusableDictionary(options), null);
  await fs.writeFile(file, Buffer.concat([source, Buffer.from('\n')]));
  const before = await inspectReusableDictionary(options);
  assert.ok(before, 'the exact appended LF produced by the downloader preserves source hash qualification');
  assert.equal(sameReusableDictionary(before, await inspectReusableDictionary(options)), true);
  await fs.rename(file, path.join(root, 'retained.txt'));
  await fs.writeFile(file, Buffer.concat([source, Buffer.from('\n')]));
  assert.equal(sameReusableDictionary(before, await inspectReusableDictionary(options)), false,
    'identical bytes in a replaced object cannot satisfy in-flight 304 reuse');
  await fs.writeFile(file, Buffer.concat([source, Buffer.from('\n\n')]));
  assert.equal(await inspectReusableDictionary({ ...options, maxBytes: 100 }), null, 'only one known added newline is allowed');
  await fs.writeFile(file, 'alpha\ngama');
  assert.equal(await inspectReusableDictionary(options), null, 'same-length corruption cannot reuse a verified manifest');
  const controller = new AbortController(); controller.abort(new Error('fixture cancelled'));
  await assert.rejects(inspectReusableDictionary({ ...options, signal: controller.signal }), /fixture cancelled/);
} finally { await rmDirRecursive(root); }
console.log('Dictionary conditional reuse requires stable contained local bytes and exact source integrity.');
