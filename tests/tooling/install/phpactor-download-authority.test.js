import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { PHPACTOR_POSIX_SHIM, PHPACTOR_WINDOWS_SHIM } from '../../../tools/tooling/approved-artifacts.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/phpactor-download-authority/')[1];
const cases = ['same-origin', 'cross-origin-rejected', 'cross-origin-approved', 'checksum-mismatch',
  'oversized', 'empty', 'mutable-url', 'private-dns', 'local-opt-in-required', 'redirect-loop'];
assert.ok(cases.includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`phpactor-authority-${selected}`);
const bin = path.join(dir, 'bin'); await fs.mkdir(bin);
const phar = path.join(bin, 'phpactor.phar');
const prior = Buffer.from('inert prior approved bytes');
await fs.writeFile(phar, prior);
const body = Buffer.from('inert explicit download fixture, never executed');
const digest = createHash('sha256').update(body).digest('hex');
let origin, destination, sourceRequests = 0, destinationRequests = 0;
const target = http.createServer((_request, response) => { destinationRequests++; response.end(body); });
const source = http.createServer((request, response) => {
  sourceRequests++;
  if (selected.startsWith('cross-origin')) { response.writeHead(302, { location: destination }).end(); return; }
  if (selected === 'redirect-loop') { response.writeHead(302, { location: '/artifact' }).end(); return; }
  if (selected === 'same-origin' && request.url === '/artifact') {
    response.writeHead(302, { location: '/bytes' }).end(); return;
  }
  if (selected === 'oversized') { response.writeHead(200, { 'content-length': 33 * 1024 * 1024 }).end('x'); return; }
  response.end(selected === 'empty' ? '' : body);
});
await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${source.address().port}`;
destination = `http://127.0.0.1:${target.address().port}`;
let url = `${origin}/artifact`;
if (selected === 'mutable-url') url = `${origin}/releases/latest/download/phpactor.phar`;
if (selected === 'private-dns') url = `https://localhost:${source.address().port}/artifact`;
const report = path.join(dir, 'report.json');
try {
  const result = await spawnSubprocess(process.execPath, ['tools/tooling/install-phpactor-phar.js',
    '--bin-dir', bin, '--url', url, '--sha256', selected === 'checksum-mismatch' ? '0'.repeat(64) : digest,
    '--retries', '0', '--timeout-ms', '1000', '--report', report], {
    cwd: process.cwd(), env: { ...applyTestEnv({ syncProcess: false }),
      PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS: ['private-dns', 'local-opt-in-required'].includes(selected) ? '0' : '1',
      PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS: JSON.stringify(selected === 'cross-origin-approved' ? [destination] : []) },
    stdio: ['ignore', 'pipe', 'pipe'], timeoutMs: 5000, maxOutputBytes: 65536, outputMode: 'string', rejectOnNonZeroExit: false
  });
  const success = ['same-origin', 'cross-origin-approved'].includes(selected);
  assert.equal(result.exitCode, success ? 0 : 1, JSON.stringify(result));
  const receipt = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.equal(receipt.status, success ? 'ok' : 'error');
  assert.deepEqual(await fs.readFile(phar), success ? body : prior, 'failed delivery cannot replace previously installed bytes');
  const entries = await fs.readdir(bin);
  assert.equal(entries.some(name => name.includes('.tmp-')), false, 'failed delivery leaves no publication temporary');
  if (success) {
    assert.equal(receipt.sha256, digest);
    assert.equal(receipt.attempts.length, 1, 'redirect hops are one attempt with zero retries');
    assert.ok(entries.includes(process.platform === 'win32' ? 'phpactor.cmd' : 'phpactor'));
    assert.equal(await fs.readFile(path.join(bin, process.platform === 'win32' ? 'phpactor.cmd' : 'phpactor'), 'utf8'),
      process.platform === 'win32' ? PHPACTOR_WINDOWS_SHIM : PHPACTOR_POSIX_SHIM,
      'the installed launcher is the same exact recipe admitted by runtime qualification');
  } else {
    const reason = { 'checksum-mismatch': 'checksum_mismatch', oversized: 'download_too_large',
      empty: 'download_empty_payload', 'mutable-url': 'immutable_url_required' }[selected] || 'download_network_error';
    assert.equal(receipt.reason, reason, JSON.stringify(receipt));
    assert.equal(entries.includes(process.platform === 'win32' ? 'phpactor.cmd' : 'phpactor'), false);
  }
  if (selected === 'same-origin') assert.equal(sourceRequests, 2);
  if (selected === 'cross-origin-rejected') {
    assert.equal(sourceRequests, 1); assert.equal(destinationRequests, 0, 'unapproved destinations are never contacted');
    assert.match(receipt.message, /cross-origin redirect requires launch-time approval/);
  }
  if (selected === 'cross-origin-approved') {
    assert.equal(sourceRequests, 1); assert.equal(destinationRequests, 1);
  }
  if (selected === 'redirect-loop') assert.equal(sourceRequests, 6, 'the existing five-redirect ceiling is retained');
  if (['mutable-url', 'private-dns', 'local-opt-in-required'].includes(selected)) {
    assert.equal(sourceRequests, 0); assert.equal(destinationRequests, 0, 'rejected authority never contacts either fixture server');
  }
  console.log(JSON.stringify({ selected, sourceRequests, destinationRequests, status: receipt.status, reason: receipt.reason }));
} finally {
  for (const server of [source, target]) {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
