import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiRouter } from '../../../tools/api/router.js';
import { createAuthorityGuard, parseRequestAuthority } from '../../../tools/api/router/authority.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const router = createApiRouter({ host: '127.0.0.1', defaultRepo: process.cwd(),
  allowedHosts: ['proxy.example:443'], cors: { allowedOrigins: ['http://allowed.test'] } });
const server = http.createServer(router.handleRequest);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const request = (host, origin, extra = {}) => new Promise((resolve, reject) => {
  const headers = { ...(host === null ? {} : { Host: host }), ...extra };
  if (origin !== undefined) headers.Origin = origin;
  const req = http.request({ hostname: '127.0.0.1', port, path: '/health', setHost: false, headers }, res => {
    res.resume(); res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject); req.end();
});
try {
  for (const origin of [undefined, 'null', 'http://allowed.test']) {
    assert.equal(await request('attacker.example:' + port, origin), 403);
  }
  for (const hostname of ['localhost', 'LOCALHOST.', '127.0.0.1', '[::1]']) {
    assert.equal(await request(hostname + ':' + port), 200);
  }
  const localAuthority = '127.0.0.1:' + port;
  assert.equal(await request(localAuthority, 'http://' + localAuthority), 200);
  for (const origin of ['null', 'http://foreign.test:' + port, 'http://localhost:' + port,
    'https://' + localAuthority, 'http://' + localAuthority + '/', 'http://' + localAuthority + '?x=1']) {
    assert.equal(await request(localAuthority, origin), 403, origin);
  }
  assert.equal(await request(localAuthority, 'https://' + localAuthority,
    { 'X-Forwarded-Proto': 'https' }), 403);
  assert.equal(await request(localAuthority, 'http://foreign.test:' + port,
    { 'X-Forwarded-Host': 'foreign.test:' + port }), 403);
  assert.equal(await request('localhost:' + (port === 65535 ? port - 1 : port + 1)), 403);
  assert.equal(await request(null), 400);
  assert.equal(await request('proxy.example:443'), 200);
  assert.equal(await request('proxy.example:444'), 403);
  assert.equal(await request('attacker.example:' + port, undefined,
    { 'X-Forwarded-Host': 'localhost:' + port }), 403);
  for (const value of ['localhost:', 'localhost:0', 'user@localhost', 'localhost/path', 'localhost,evil', 'localhost%00']) {
    assert.equal(parseRequestAuthority(value), null);
  }
  const ipv6 = createAuthorityGuard({ host: '::1' });
  assert.equal(ipv6({ headers: { host: '[::1]:7345' }, socket: { localAddress: '::1', localPort: 7345 } }).ok, true);
  assert.equal(ipv6({ headers: { host: '[::1]:7345' }, socket: { localAddress: '::1', localPort: 7345 },
    rawHeaders: ['Host', '[::1]:7345', 'Host', 'evil.test'] }).status, 400);
  const protectedRouter = createApiRouter({ host: '127.0.0.1', defaultRepo: process.cwd(),
    allowedHosts: ['proxy.example:443'], auth: { required: true, token: 'fixture-token' } });
  const protectedServer = http.createServer(protectedRouter.handleRequest);
  await new Promise(resolve => protectedServer.listen(0, '127.0.0.1', resolve));
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port: protectedServer.address().port,
        path: '/health', headers: { Host: 'proxy.example:443' } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
    });
    assert.equal(status, 401);
    const protectedPort = protectedServer.address().port;
    const sameOriginStatus = await new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port: protectedPort,
        path: '/health', headers: { Origin: 'http://127.0.0.1:' + protectedPort } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
    });
    assert.equal(sameOriginStatus, 401, 'same-origin admission preserves data authentication');
  } finally {
    await protectedRouter.close();
    await new Promise(resolve => protectedServer.close(resolve));
  }
  console.log('Listener authorities, explicit proxy hosts and independent Origin/token boundaries passed.');
} finally {
  await router.close();
  await new Promise(resolve => server.close(resolve));
}
