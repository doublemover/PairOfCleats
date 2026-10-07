#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { applyTestEnv } from '../../helpers/test-env.js';
import { fetchDownloadUrl } from '../../../tools/download/shared-fetch.js';

applyTestEnv();
process.env.PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS = '1';
let crossOriginUrl = '';

const server = http.createServer((req, res) => {
  switch (req.url) {
    case '/cross-origin':
      res.statusCode = 302;
      res.setHeader('Location', crossOriginUrl);
      res.end();
      return;
    case '/ok':
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end('payload');
      return;
    case '/stream':
      res.statusCode = 200;
      res.write('stream-');
      setTimeout(() => {
        res.end('payload');
      }, 5);
      return;
    case '/redirect':
      res.statusCode = 302;
      res.setHeader('Location', '/ok');
      res.end();
      return;
    case '/redirect-loop':
      res.statusCode = 302;
      res.setHeader('Location', '/redirect-loop');
      res.end();
      return;
    case '/redirect-missing':
      res.statusCode = 302;
      res.end();
      return;
    case '/large':
      res.statusCode = 200;
      res.setHeader('Content-Length', '20');
      res.end('xxxxxxxxxxxxxxxxxxxx');
      return;
    case '/slow':
      setTimeout(() => {
        res.statusCode = 200;
        res.end('late');
      }, 300);
      return;
    default:
      res.statusCode = 404;
      res.end('missing');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const baseUrl = `http://127.0.0.1:${port}`;
let receivedAuthorization = null;
const second = http.createServer((req, res) => {
  receivedAuthorization = req.headers.authorization;
  res.end('cross-origin fixture');
});
await new Promise((resolve) => second.listen(0, '127.0.0.1', resolve));
const secondOrigin = `http://127.0.0.1:${second.address().port}`;
crossOriginUrl = `${secondOrigin}/fixture`;

try {
  await assert.rejects(() => fetchDownloadUrl(`${baseUrl}/cross-origin`), /launch-time approval/);
  process.env.PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS = JSON.stringify([secondOrigin]);
  await fetchDownloadUrl(`${baseUrl}/cross-origin`, { headers: { Authorization: 'inert-fixture-header' } });
  assert.equal(receivedAuthorization, undefined, 'approved origin changes must not forward credentials');
  delete process.env.PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS;
  const originalRequest = https.request;
  try {
    https.request = (_url, _options, callback) => {
      const request = new EventEmitter();
      request.destroy = () => {};
      request.end = () => callback({ statusCode: 302, headers: { location: `${baseUrl}/ok` }, resume() { request.emit('close'); } });
      return request;
    };
    await assert.rejects(() => fetchDownloadUrl('https://example.invalid/redirect'), /downgrade/);
  } finally { https.request = originalRequest; }
  const scheduledTimeouts = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = ((handler, timeout, ...args) => {
    scheduledTimeouts.push(Number(timeout));
    return originalSetTimeout(handler, timeout, ...args);
  });
  try {
    await fetchDownloadUrl(`${baseUrl}/ok`, { timeoutMs: undefined });
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.ok(
    scheduledTimeouts.includes(30000),
    'downloads should have a bounded default request timeout'
  );

  const redirected = await fetchDownloadUrl(`${baseUrl}/redirect`);
  assert.equal(redirected.statusCode, 200, 'redirected request should resolve to 200');
  assert.equal(redirected.body.toString('utf8'), 'payload', 'redirected response body mismatch');
  assert.equal(redirected.redirects, 1, 'redirect count mismatch');

  const streamed = await fetchDownloadUrl(`${baseUrl}/stream`, { responseType: 'stream' });
  let streamedBody = '';
  for await (const chunk of streamed.stream) {
    streamedBody += chunk.toString('utf8');
  }
  assert.equal(streamedBody, 'stream-payload', 'stream response payload mismatch');

  await assert.rejects(
    () => fetchDownloadUrl(`${baseUrl}/redirect-loop`, { maxRedirects: 2 }),
    /too many redirects/,
    'expected redirect loop to fail'
  );
  await assert.rejects(
    () => fetchDownloadUrl(`${baseUrl}/redirect-missing`),
    /redirect missing location header/,
    'expected redirect without location to fail'
  );
  await assert.rejects(
    () => fetchDownloadUrl(`${baseUrl}/large`, { maxBytes: 10 }),
    /response exceeds maxBytes/,
    'expected maxBytes to reject oversized response'
  );
  await assert.rejects(
    () => fetchDownloadUrl(`${baseUrl}/slow`, { timeoutMs: 50 }),
    /timeout after 50ms/,
    'expected timeout to reject slow response'
  );
} finally {
  server.close();
  second.close();
  delete process.env.PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS;
}

console.log('shared fetch contract test passed');
