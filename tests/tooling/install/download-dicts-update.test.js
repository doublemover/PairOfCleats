import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setupDownloadDictsTest, runDownloadDicts } from './download-dicts-test-helper.js';

const { tempRoot, sourceFile, sourceHash } = await setupDownloadDictsTest('download-dicts-update');
const bytes = await fs.readFile(sourceFile);
const requests = [];
let unexpected304 = false, removeDuringRequest = false;
const output = path.join(tempRoot, 'test.txt');
const server = http.createServer(async (req, res) => {
  requests.push({ url: req.url, headers: req.headers });
  if (removeDuringRequest) { removeDuringRequest = false; await fs.rm(output, { force: true }); }
  if (unexpected304 || req.headers['if-none-match'] === '"words-v1"') {
    res.writeHead(304); res.end(); return;
  }
  res.writeHead(200, { ETag: '"words-v1"', 'Last-Modified': 'Mon, 19 Oct 2026 00:00:00 GMT' });
  res.end(bytes);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const run = (urlPath = '/words.txt', extra = []) => runDownloadDicts([
  '--lang', 'test', '--url', `test=${baseUrl}${urlPath}`, '--sha256', `test=${sourceHash}`,
  '--dir', tempRoot, ...extra
], { logName: 'download-dicts-update' });
try {
  assert.equal((await run()).code, 0);
  await fs.rm(output);
  const missing = await run('/words.txt', ['--update']);
  assert.equal(missing.code, 0, missing.stderr);
  assert.deepEqual(await fs.readFile(output), bytes, 'retained receipt must not suppress restoring missing bytes');
  assert.equal(requests.at(-1).headers['if-none-match'], undefined);
  const valid = await run('/words.txt', ['--update']);
  assert.equal(valid.code, 0, valid.stderr);
  assert.match(valid.stderr, /downloaded=0 skipped=1 failed=0/);
  assert.equal(requests.at(-1).headers['if-none-match'], '"words-v1"');
  assert.ok(requests.at(-1).headers['if-modified-since']);
  await fs.writeFile(output, '');
  const empty = await run('/words.txt', ['--update']);
  assert.equal(empty.code, 0, empty.stderr);
  assert.deepEqual(await fs.readFile(output), bytes);
  assert.equal(requests.at(-1).headers['if-none-match'], undefined, 'empty bytes cannot authorize 304 reuse');
  const changed = await run('/other-source.txt', ['--update']);
  assert.equal(changed.code, 0, changed.stderr);
  assert.equal(requests.at(-1).headers['if-none-match'], undefined, 'source identity fences validators');
  assert.equal(requests.at(-1).headers['if-modified-since'], undefined);
  const forced = await run('/other-source.txt', ['--update', '--force']);
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(requests.at(-1).headers['if-none-match'], undefined);
  removeDuringRequest = true;
  const vanished = await run('/other-source.txt', ['--update']);
  assert.equal(vanished.code, 1, '304 must recheck bytes removed while request is in flight');
  assert.match(vanished.stderr, /304.*local|local.*304/i);
  unexpected304 = true;
  const unexpected = await run('/other-source.txt', ['--update']);
  assert.equal(unexpected.code, 1, 'unexpected 304 without bytes is a failure');
  assert.match(unexpected.stderr, /failed=1/);
} finally {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(tempRoot, { recursive: true, force: true });
}
console.log('Dictionary updates bind conditional requests to usable local bytes and source identity');
