import assert from 'node:assert/strict';
import { createTuiApiServices } from '../../tools/tui/operator/api-service.js';

const scope = { id: 'selected', configRoot: process.cwd() };
const argv = ['service', 'api', '--host=127.0.0.1', '--port=0', '--json'];
{
  let probes = 0;
  const owner = createTuiApiServices({ toolRoot: process.cwd(), requireScope: () => {},
    spawn: async (_command, _args, options) => {
      options.onSpawn({ pid: 123 });
      options.onStderr('Error: listen EADDRINUSE: address already in use');
      return { exitCode: 1 };
    }, probe: async () => { probes += 1; return { ok: true }; } });
  await assert.rejects(owner.run({ scope, jobId: 'occupied', argv }, { signal: new AbortController().signal, env: {},
    onSpawn: () => {}, onActivity: () => {} }), { code: 'ERR_TUI_API_PORT_IN_USE' });
  assert.equal(probes, 0, 'occupied/unowned endpoint is never probed as this service');
  await owner.dispose();
}
{
  let finish, health, probes = 0;
  const healthy = new Promise(resolve => { health = resolve; });
  const owner = createTuiApiServices({ toolRoot: process.cwd(), requireScope: () => {},
    spawn: async (_command, args, options) => {
      assert.deepEqual(args.slice(1), argv);
      options.onSpawn({ pid: 456 });
      options.onStdout(JSON.stringify({ ok: true, host: '127.0.0.1', port: 12345, repo: scope.configRoot,
        baseUrl: 'http://127.0.0.1:12345' }) + '\n');
      return new Promise(resolve => { finish = () => resolve({ exitCode: 0 });
        options.signal.addEventListener('abort', finish, { once: true }); });
    }, probe: async port => { probes += 1; assert.equal(port, 12345); return { ok: true }; } });
  const abort = new AbortController();
  const running = owner.run({ scope, jobId: 'owned', argv }, { signal: abort.signal, env: {},
    onSpawn: () => {}, onActivity: () => health() });
  await healthy;
  const status = owner.status(scope.id)[0];
  assert.equal(status.pid, 456); assert.equal(status.phase, 'healthy');
  assert.equal(status.endpoint, 'http://127.0.0.1:12345'); assert.equal(probes, 1);
  abort.abort();
  assert.equal((await running).exitCode, 130);
  assert.deepEqual(owner.status(scope.id), []);
  await owner.dispose();
}
{
  let probes = 0;
  const owner = createTuiApiServices({ toolRoot: process.cwd(), requireScope: () => {},
    spawn: async (_command, _args, options) => {
      options.onSpawn({ pid: 789 });
      options.onStdout(JSON.stringify({ ok: true, host: '0.0.0.0', port: 12345, repo: scope.configRoot,
        baseUrl: 'http://0.0.0.0:12345' }) + '\n');
      return { exitCode: 1 };
    }, probe: async () => { probes += 1; return { ok: true }; } });
  await assert.rejects(owner.run({ scope, jobId: 'wrong-host', argv }, { signal: new AbortController().signal, env: {},
    onSpawn: () => {}, onActivity: () => {} }), { code: 'ERR_TUI_API_STARTUP' });
  assert.equal(probes, 0);
}
console.log('Owned API startup identity, occupied-port isolation, bounded health and local cancellation');
