import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCorsResolver } from '../../../tools/api/router/cors.js';
import { sendError } from '../../../tools/api/response.js';
import { createSseResponder } from '../../../tools/api/sse.js';
import { OBSERVABILITY_HEADER_NAMES } from '../../../src/shared/observability.js';
const cors = createCorsResolver({ allowedOrigins: ['https://dashboard.example'] });
const granted = cors.resolveCorsHeaders({ headers: { origin: 'https://dashboard.example' } });
for (const name of OBSERVABILITY_HEADER_NAMES) {
  assert.ok(granted['Access-Control-Allow-Headers'].includes(name));
  assert.ok(granted['Access-Control-Expose-Headers'].includes(name));
}
assert.equal(cors.resolveCorsHeaders({ headers: { origin: 'https://unapproved.example' } }), null);
for (const message of ['Repo path not found: /srv/example-checkout', 'Repo path not found: C:\\Example\\Checkout',
  "ENOENT: no such file or directory, open '/srv/example-cache/state.json'", 'Denied \\\\server\\share\\private.txt']) {
  let json;
  const response = { writeHead() {}, end(body) { json = JSON.parse(body); } };
  sendError(response, 500, 'INTERNAL', message, { query: '/ordinary/source/query', errors: [{ path: '/top', message: '/top must be integer' }] });
  assert.equal(json.message.includes('/srv/'), false);
  assert.equal(json.message.includes('C:\\Example'), false);
  assert.equal(json.message.includes('server\\share'), false);
  assert.equal(json.query, '/ordinary/source/query');
  assert.equal(json.errors[0].path, '/top');
  assert.equal(json.errors[0].message, '/top must be integer');
  const req = new EventEmitter(), res = new EventEmitter();
  let chunks = '';
  res.write = chunk => { chunks += chunk; return true; }; res.writeHead = () => {}; res.end = () => {};
  const sse = createSseResponder(req, res);
  await sse.sendEvent('error', { message });
  assert.equal(chunks.includes('/srv/'), false);
  assert.equal(chunks.includes('Example'), false);
  chunks = '';
  await sse.sendEvent('result', { result: { query: '/ordinary/source/query', code: [{ text: 'const location = "/srv/source";' }] } });
  assert.ok(chunks.includes('/srv/source'), 'source content is not a public diagnostic');
}
console.log('CORS correlation and public diagnostic projection passed');
