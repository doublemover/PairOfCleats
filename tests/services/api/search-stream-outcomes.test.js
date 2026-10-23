#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { registerHooks } from 'node:module';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { parseSseEvents } from '../../helpers/api-server.js';

// Replace only the expensive search boundary; exercise the real HTTP router,
// response ownership, error projection and SSE serialization together.
const hook = registerHooks({
  load(url, context, next) {
    if (url.endsWith('/src/integrations/core/search.js')) {
      return { format: 'module', shortCircuit: true,
        source: 'export const search = (...args) => globalThis.__streamSearchFixture(...args);' };
    }
    return next(url, context);
  }
});
const { createApiRouter } = await import('../../../tools/api/router.js');
const { createSseResponder } = await import('../../../tools/api/sse.js');
const router = createApiRouter({ host: '127.0.0.1', defaultRepo: process.cwd() });
const server = http.createServer(router.handleRequest);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (route, payload = { query: '/api/status', mode: 'code' }, expectedStatus = 200) => {
  const response = await fetch(base + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, expectedStatus);
  return response;
};
try {
  globalThis.__streamSearchFixture = () => assert.fail('invalid admission cannot start a search');
  const invalidStream = await post('/search/stream', {}, 400);
  assert.match(invalidStream.headers.get('content-type'), /application\/json/u,
    'pre-header stream admission failure retains its HTTP JSON error contract');
  const invalidBody = await invalidStream.json();
  assert.equal(invalidBody.ok, false); assert.equal(invalidBody.code, ERROR_CODES.INVALID_REQUEST);
  assert.equal(invalidBody.namespaceCode, 'poc.invalid_request');
  assert.equal(typeof invalidBody.hint, 'string');

  for (const [error, code] of [
    [new Error('Index not found. Build an index first.'), ERROR_CODES.NO_INDEX],
    [Object.assign(new Error('Unsupported index format: rebuild required.'), {
      code: 'ERR_INDEX_FORMAT_UNSUPPORTED',
      details: { expectedVersion: 3, foundVersion: 1, rebuildCommand: 'pairofcleats index build' }
    }), ERROR_CODES.INVALID_REQUEST],
    [new Error('Search backend failed.'), ERROR_CODES.INTERNAL]
  ]) {
    globalThis.__streamSearchFixture = async () => { throw error; };
    const events = parseSseEvents(await (await post('/search/stream')).text());
    assert.equal(events.filter(event => event.event === 'error').length, 1);
    assert.equal(events.filter(event => event.event === 'done').length, 1);
    assert.equal(events.at(-1).event, 'done');
    assert.equal(events.at(-1).data.ok, false);
    const diagnostic = events.find(event => event.event === 'error').data;
    assert.equal(diagnostic.code, code, JSON.stringify(diagnostic));
    assert.equal(diagnostic.message, error.message);
    assert.equal(events.some(event => event.event === 'result'), false);
    if (error.details) {
      assert.equal(diagnostic.nativeCode, error.code);
      assert.equal(diagnostic.expectedVersion, 3);
      assert.equal(diagnostic.foundVersion, 1);
      assert.equal(diagnostic.details.rebuildCommand, error.details.rebuildCommand);
    }
  }
  for (const snippet of ['/** ordinary documentation */\nfunction status() {}', '// line comment', 'function plain() {}']) {
    globalThis.__streamSearchFixture = async () => ({ query: '/api/status',
      code: [{ file: 'src/status.js', snippet }],
      retrieval: { indexPath: '/private/cache/index' }, observability: { repoRoot: '/private/repository' } });
    const json = await (await post('/search')).json();
    assert.equal(json.ok, true); assert.equal(Object.hasOwn(json, 'result'), true);
    assert.equal(Object.hasOwn(json, 'results'), false, 'JSON success retains the shipped singular result envelope');
    const events = parseSseEvents(await (await post('/search/stream')).text());
    assert.equal(events.filter(event => event.event === 'done').length, 1);
    assert.equal(events.at(-1).data.ok, true);
    const streamed = events.find(event => event.event === 'result').data.result;
    assert.deepEqual(streamed, json.result, 'JSON and SSE preserve the same search content and redact metadata');
    assert.equal(streamed.query, '/api/status');
    assert.equal(streamed.code[0].snippet, snippet);
    assert.equal(JSON.stringify(streamed).includes('/private/'), false);
  }
  globalThis.__streamSearchFixture = async (_repo, options) => {
    assert.equal(options.query, ''); assert.ok(options.args.includes('--ext'));
    return { code: [], prose: [] };
  };
  const filtered = await fetch(`${base}/search?ext=.js&mode=code&backend=memory&top=5`, {
    signal: AbortSignal.timeout(3000)
  });
  assert.equal(filtered.status, 200, 'documented filter-only GET does not require q');
  assert.deepEqual((await filtered.json()).result.code, []);
  const req = new EventEmitter(), res = new EventEmitter();
  let ends = 0;
  res.writeHead = () => { res.headersSent = true; };
  res.write = () => { throw new Error('transport failed'); };
  res.end = () => { ends++; res.writableEnded = true; };
  const sse = createSseResponder(req, res);
  await assert.rejects(sse.sendHeaders(), /transport failed/);
  sse.end(); sse.end();
  assert.equal(ends, 1, 'terminal response ownership is idempotent');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await router.close();
  hook.deregister();
  delete globalThis.__streamSearchFixture;
}
console.log('HTTP streaming search failures and JSON/SSE content parity passed');
