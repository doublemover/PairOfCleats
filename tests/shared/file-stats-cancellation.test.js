import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { countFileLines, countLinesForEntries } from '../../src/shared/file-stats.js';
import { prepareTestCacheDir } from '../helpers/test-cache.js';

const { dir } = await prepareTestCacheDir('file-stats-cancellation');
const originalCreate = fs.createReadStream;
try {
  const empty = path.join(dir, 'empty'), text = path.join(dir, 'text');
  await fsPromises.writeFile(empty, '');
  await fsPromises.writeFile(text, 'first\r\nsecond');
  assert.equal(await countFileLines(empty), 0);
  assert.equal(await countFileLines(text), 2);
  await assert.rejects(countFileLines(path.join(dir, 'missing')), { code: 'ERR_FILE_LINE_COUNT', causeCode: 'ENOENT' });
  const cancelled = new AbortController();
  cancelled.abort();
  let opened = 0;
  fs.createReadStream = () => { opened += 1; assert.fail('pre-aborted calls must not open streams'); };
  await assert.rejects(countLinesForEntries([{ abs: text, rel: 'text' }], { signal: cancelled.signal }), { name: 'AbortError' });
  assert.equal(opened, 0);
  const controller = new AbortController();
  let releaseClose, created;
  const started = new Promise(resolve => { created = resolve; });
  fs.createReadStream = (_target, { signal }) => {
    opened += 1;
    const stream = new Readable({ read() {}, destroy(error, callback) { releaseClose = () => callback(error); } });
    signal.addEventListener('abort', () => stream.destroy(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' })), { once: true });
    created();
    return stream;
  };
  let settled = false;
  const pending = countLinesForEntries([{ abs: text, rel: 'first' }, { abs: text, rel: 'queued' }],
    { signal: controller.signal, concurrency: 1 }).finally(() => { settled = true; });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started;
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'cancellation waits for actual owned stream close');
  assert.equal(opened, 1, 'queued reads must not start after cancellation');
  releaseClose();
  await rejected;
  for (const [code, partial] of [['EACCES', false], ['EIO', true]]) {
    const primary = Object.freeze(Object.assign(new Error('controlled line read failure'), { code }));
    let closed = false;
    fs.createReadStream = () => {
      let started = false;
      const stream = new Readable({ read() { if (started) return; started = true;
        if (partial) this.push(Buffer.from('partial\r\nsource'));
        queueMicrotask(() => this.destroy(primary)); } });
      stream.once('close', () => { closed = true; }); return stream;
    };
    await assert.rejects(countFileLines(text), error => error.code === 'ERR_FILE_LINE_COUNT' && error.cause === primary && error.causeCode === code);
    assert.equal(closed, true, 'unknown/partially read counts never settle as reusable zero before original close');
  }
  const between = new AbortController(); let streams = 0;
  fs.createReadStream = () => {
    streams++;
    const stream = Readable.from([Buffer.from('one\r\ntwo')]);
    stream.once('end', () => between.abort()); return stream;
  };
  await assert.rejects(countLinesForEntries([{ abs: text, rel: 'first' }, { abs: text, rel: 'second' }],
    { signal: between.signal, concurrency: 1 }), { name: 'AbortError' });
  assert.equal(streams, 1, 'cancellation between files stops queued admission');
  fs.createReadStream = originalCreate;
  const counts = await countLinesForEntries([{ abs: text, rel: 'text' }, { abs: empty, rel: 'empty' }], { concurrency: 2 });
  assert.deepEqual([...counts].sort(), [['empty', 0], ['text', 2]], 'concurrent healthy observations distinguish genuine empty and CRLF source');
} finally {
  fs.createReadStream = originalCreate;
  await fsPromises.rm(dir, { recursive: true, force: true });
}
console.log('file stats cancellation test passed');
