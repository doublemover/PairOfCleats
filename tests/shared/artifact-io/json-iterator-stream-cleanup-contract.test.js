#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readJsonLinesIterator } from '../../../src/shared/artifact-io/json/read-jsonl-stream.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// The old source regex required synchronous destroyStream spelling. The owner
// now awaits every source/decoder close. Exercise that stronger obligation at
// the actual candidate/fallback boundary instead of pinning its syntax.
const root = await makeTempDir('poc-jsonl-candidate-cleanup-');
const primary = path.join(root, 'rows.jsonl.gz'), backup = primary + '.bak';
const row = { text: randomBytes(256 * 1024).toString('base64') };
const bytes = gzipSync(Buffer.from(JSON.stringify(row) + '\n'));
assert.ok(bytes.length > 128 * 1024, 'both candidates must use streaming I/O');
const originalCreate = fsSync.createReadStream;
const failure = Object.assign(new Error('candidate pipe setup failed'), { code: 'EIO' });
let sources = [];
fsSync.createReadStream = function (filename, ...args) {
  if (filename === backup) {
    assert.equal(sources[0].destroyed, true);
    assert.equal(sources[0].closed, true, 'failed candidate must close before fallback acquisition');
  }
  const stream = originalCreate.call(this, filename, ...args);
  sources.push(stream);
  if (filename === primary) stream.pipe = () => { throw failure; };
  return stream;
};
try {
  await fs.writeFile(primary, bytes); await fs.writeFile(backup, bytes);
  const recovered = [];
  for await (const entry of readJsonLinesIterator(primary, { recoveryFallback: true })) recovered.push(entry);
  assert.deepEqual(recovered, [row]); assert.equal(sources.length, 2);
  assert.ok(sources.every(stream => stream.closed && stream.destroyed));
  sources = [];
  await assert.rejects(async () => {
    for await (const _entry of readJsonLinesIterator(primary)) assert.fail('strict mode cannot use fallback');
  }, error => error === failure);
  assert.equal(sources.length, 1); assert.equal(sources[0].closed, true);
  assert.deepEqual(await fs.readFile(backup), bytes, 'recovery preserves the backup source');
} finally {
  fsSync.createReadStream = originalCreate;
  await rmDirRecursive(root);
}

console.log('json iterator stream cleanup contract test passed');
