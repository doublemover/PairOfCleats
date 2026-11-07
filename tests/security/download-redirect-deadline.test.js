import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchDownloadUrl } from '../../tools/download/shared-fetch.js';

const requests = [];
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('security/download-redirect-deadline/')[1];
assert.ok(['redirect', 'body'].includes(selected));
const server = http.createServer((request, response) => {
  requests.push({ path: request.url, at: Date.now() });
  if (request.url === '/body') {
    response.writeHead(200); response.write('initial bytes');
    setTimeout(() => response.end('late bytes'), 400);
    return;
  }
  setTimeout(() => {
    if (request.url === '/first') response.writeHead(302, { location: '/second' }).end();
    else response.end('bounded payload');
  }, 120);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/${selected === 'body' ? 'body' : 'first'}`;
try {
  await assert.rejects(fetchDownloadUrl(url, { allowLocal: true, timeoutMs: 200 }), { code: 'ERR_DOWNLOAD_TIMEOUT' },
    'one download attempt shares its deadline across all redirect hops');
  assert.equal(requests.length, selected === 'body' ? 1 : 2, 'the intended slow operation must actually start');
  console.log(JSON.stringify({ requests, budgetMs: 200 }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log('Download redirect hops retain a single attempt deadline.');
