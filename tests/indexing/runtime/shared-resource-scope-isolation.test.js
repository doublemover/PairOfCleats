import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createRunResourceScope } from '../../../src/shared/lifecycle/run-scope.js';
import { teardownRuntime } from '../../../src/integrations/core/build-index/runtime.js';
import { withLspSession, __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { getPythonAstPool, shutdownPythonAstPool } from '../../../src/lang/python/pool.js';
import { getTreeSitterWorkerPool, shutdownTreeSitterWorkerPool } from '../../../src/lang/tree-sitter/worker.js';
import { awaitToolingProviderPreflight } from '../../../src/index/tooling/preflight-manager.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { trackedSubprocesses, withTrackedSubprocessSignalScope } from '../../../src/shared/subprocess/tracking.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'distinct-workspaces';
assert.ok(['distinct-workspaces', 'shared-workspace', 'cancelled-shared-workspace', 'host-cache'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('runtime-resource-scope-' + selected);
const roots = [path.join(dir, 'a'), path.join(dir, 'b')];
for (const root of roots) await fs.mkdir(root);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([dir, ...roots])
} });
const scopes = roots.map(() => createRunResourceScope());
const abortControllers = scopes.map(() => new AbortController());
const logs = [], pools = [], preflights = [], lspRelease = Promise.withResolvers(), lspEntered = Promise.withResolvers();
const runtimes = scopes.map((resourceScope, index) => ({ root: roots[index], resourceScope,
  log: line => logs.push(line), indexingConfig: { stage1: { watchdog: { cleanupTimeoutMs: 3000 } } },
  subprocessOwnership: { stage1FilePrefix: `stage1:scope-${resourceScope.id}:`, preflightPrefix: `tooling-preflight:${resourceScope.id}:` } }));
const within = (index, action) => scopes[index].run(() => withTrackedSubprocessSignalScope(null,
  runtimes[index].subprocessOwnership.stage1FilePrefix + 'file', action));

// Observe the real Piscina constructor, worker entry and destruction; no native
// adapter or worker execution is replaced by the recording subclass.
const actualPiscina = pathToFileURL(createRequire(import.meta.url).resolve('piscina')).href;
globalThis.__runtimeScopePiscina = pools;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'piscina' && context.parentURL?.endsWith('/lang/tree-sitter/worker.js')) {
      return { url: 'runtime-scope:piscina', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'runtime-scope:piscina') return { format: 'module', shortCircuit: true, source: `
      import Actual from ${JSON.stringify(actualPiscina)};
      export default class ObservedPiscina extends Actual {
        constructor(options){super(options);globalThis.__runtimeScopePiscina.push(this);}
      }` };
    return next(url, context);
  }
});
const pythonConfig = { workerCount: 1, maxWorkers: 1, maxRetries: 0 };
const treeConfig = { enabled: true, maxWorkers: 1 };
const pythonArgs = { dataflow: false, controlFlow: false, path: null };
const pythonText = 'def scope_marker(value):\n    return value + 1\n';
const treePayload = { text: 'function scope_marker(value) { return value + 1; }', languageId: 'javascript', ext: '.js',
  treeSitter: { enabled: true, strict: true } };
const parsePython = async pool => {
  assert.ok(pool, 'the prepared Windows launch must supply a real Python interpreter');
  const result = await pool.request(pythonText, pythonArgs);
  assert.ok(result?.defs?.some(row => row.name === 'scope_marker'), 'real Python AST contains the fixture definition');
};
const parseTree = async pool => {
  assert.ok(pool, 'the prepared native worker route must be active');
  const rows = await pool.run(treePayload, { name: 'parseTreeSitter' });
  assert.ok(Array.isArray(rows) && rows.length > 0);
  assert.ok(JSON.stringify(rows).includes('scope_marker'), 'real native worker returns fixture source metadata');
};
const server = path.resolve('tests/fixtures/lsp/stub-lsp-server.js');
const sessionOptions = root => ({ cmd: process.execPath, args: [server, '--mode', 'clangd'], cwd: root,
  repoRoot: root, workspaceKey: root, providerId: 'runtime-scope-fixture', env,
  timeoutMs: 1500, retries: 0, sessionIdleTimeoutMs: 60000, log: line => logs.push(line) });
const useLsp = async lease => {
  if (lease.shouldInitialize) {
    lease.markInitializing();
    lease.markInitialized(await lease.client.initialize({ rootUri: pathToFileURL(dir).href, timeoutMs: 1500 }));
  }
  const rows = await lease.client.request('textDocument/documentSymbol', {
    textDocument: { uri: pathToFileURL(path.join(dir, 'fixture.cpp')).href }
  }, { timeoutMs: 1500 });
  assert.ok(Array.isArray(rows) && rows.some(row => row.name === 'add'), 'the real fixture LSP transport remains usable');
};
const beginPreflight = async index => {
  const ready = Promise.withResolvers(), pong = Promise.withResolvers();
  const record = { child: null, ready, pong, result: null }; preflights.push(record);
  const script = "process.stdout.write('ready\\n');process.stdin.on('data',chunk=>{if(String(chunk).trim()==='quit')process.exit(0);else process.stdout.write('pong\\n');});";
  const provider = { id: 'fixture-scope-provider', preflightId: 'fixture-scope-probe', preflightTimeoutMs: 20000,
    preflight: async () => {
      const child = await spawnSubprocess(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'],
        rejectOnNonZeroExit: false, onSpawn: value => { record.child = value; }, onStdout: value => {
          if (String(value).includes('ready')) ready.resolve();
          if (String(value).includes('pong')) pong.resolve();
        } });
      if (child.exitCode !== 0) throw Object.assign(new Error('Expected fixture preflight cancellation.'), { code: 'ABORT_ERR', name: 'AbortError' });
      return { state: 'ready', message: 'fixture process completed' };
    } };
  const ctx = { rootDir: roots[index], repoRoot: roots[index], logger: line => logs.push(line),
    abortSignal: abortControllers[index].signal };
  record.result = within(index, () => awaitToolingProviderPreflight(ctx, { provider }));
  record.result.catch(() => {});
  await Promise.race([ready.promise, record.result.then(() => { throw new Error('Fixture preflight exited before readiness.'); })]);
  return { record, late: () => within(index, () => awaitToolingProviderPreflight(ctx, { provider })) };
};
let pendingLsp = null, pendingParsers = null, hostPython = null, hostTree = null, primary = null;
const parsersEntered = Promise.withResolvers(), parsersRelease = Promise.withResolvers();
let parsersFinished = false;
try {
  if (selected === 'host-cache') {
    hostPython = await getPythonAstPool(() => {}, pythonConfig); await parsePython(hostPython);
    hostTree = await getTreeSitterWorkerPool(treeConfig); await parseTree(hostTree);
    await withLspSession(sessionOptions(dir), useLsp);
  }
  const python = [], trees = [];
  for (let index = 0; index < 2; index++) {
    python.push(await within(index, () => getPythonAstPool(() => {}, pythonConfig)));
    trees.push(await within(index, () => getTreeSitterWorkerPool(treeConfig)));
    await parsePython(python[index]); await parseTree(trees[index]);
  }
  assert.equal(pools.length, selected === 'host-cache' ? 2 : 1, 'equal immutable pool policies share one scoped constructor');
  const lspRootA = selected === 'host-cache' ? dir : roots[0];
  const lspRootB = selected.includes('shared-workspace') || selected === 'host-cache' ? lspRootA : roots[1];
  await within(0, () => withLspSession(sessionOptions(lspRootA), useLsp));
  pendingLsp = within(1, () => withLspSession(sessionOptions(lspRootB), async lease => {
    await useLsp(lease); lspEntered.resolve(); await lspRelease.promise; await useLsp(lease);
  }));
  pendingLsp.catch(() => {});
  await Promise.race([lspEntered.promise, pendingLsp.then(() => { throw new Error('Fixture LSP exited before its held callback.'); })]);
  const first = await beginPreflight(0), second = await beginPreflight(1);
  pendingParsers = scopes[1].track(async () => {
    parsersEntered.resolve(); await parsersRelease.promise;
    await parsePython(python[1]); await parseTree(trees[1]); parsersFinished = true;
  });
  pendingParsers.catch(() => {}); await parsersEntered.promise;
  assert.ok([...trackedSubprocesses.values()].some(entry => entry.child?.pid === first.record.child.pid
    && entry.ownershipId?.startsWith(runtimes[0].subprocessOwnership.preflightPrefix)));
  const pythonChildren = [...trackedSubprocesses.values()].filter(entry => entry.ownershipId?.startsWith('shared-resource:'));
  assert.ok(pythonChildren.length >= 1, 'Python workers belong to shared resource scope, not a creator file');

  first.record.expectedCancellation = true;
  if (selected === 'cancelled-shared-workspace') {
    abortControllers[0].abort(Object.assign(new Error('Fixture run A cancelled.'), { name: 'AbortError', code: 'ABORT_ERR' }));
  }
  await teardownRuntime(runtimes[0]);
  assert.equal(parsersFinished, false, 'finishing A does not drain or cancel B’s accepted parser task');
  assert.equal(scopes[0].isSettled(), true);
  await assert.rejects(first.record.result, { code: 'ABORT_ERR' });
  assert.ok(first.record.child.exitCode !== null || first.record.child.signalCode !== null);
  assert.equal(second.record.child.exitCode, null); assert.equal(second.record.child.signalCode, null);
  second.record.child.stdin.write('ping\n'); await second.record.pong.promise;
  parsersRelease.resolve(); await pendingParsers;
  await assert.rejects(python[0].request(pythonText, pythonArgs), { code: 'ABORT_ERR' });
  await assert.rejects(trees[0].run(treePayload, { name: 'parseTreeSitter' }), { code: 'ABORT_ERR' });
  await assert.rejects(within(0, () => withLspSession(sessionOptions(lspRootA), useLsp)), { code: 'ABORT_ERR' });
  await assert.rejects(first.late(), { code: 'ABORT_ERR' });
  lspRelease.resolve(); await pendingLsp;
  second.record.child.stdin.write('quit\n'); await second.record.result;
  await teardownRuntime(runtimes[1]); assert.equal(scopes[1].isSettled(), true);
  const scopedPool = pools.at(-1); assert.equal(scopedPool.threads.length, 0); assert.equal(scopedPool.queueSize, 0);
  assert.equal([...trackedSubprocesses.values()].filter(entry => entry.ownershipId?.startsWith('shared-resource:')).length, 0);
  if (selected === 'host-cache') {
    await parsePython(hostPython); await parseTree(hostTree); await withLspSession(sessionOptions(dir), useLsp);
    assert.ok(pools[0].threads.length > 0, 'individual runs cannot close process-owned parser caches');
  }
} catch (error) { primary = error; }
finally {
  const errors = primary ? [primary] : [];
  lspRelease.resolve(); parsersRelease.resolve();
  const lsp = await Promise.allSettled([pendingLsp, pendingParsers]);
  for (const result of lsp) if (result.status === 'rejected' && !errors.includes(result.reason)) errors.push(result.reason);
  for (const record of preflights) if (record.child?.exitCode === null && record.child?.signalCode === null) record.child.stdin.write('quit\n');
  const results = await Promise.allSettled(preflights.map(record => record.result));
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === 'rejected' && !(preflights[index].expectedCancellation && result.reason.code === 'ABORT_ERR')) errors.push(result.reason);
  }
  for (const result of await Promise.allSettled(scopes.map(scope => scope.close()))) {
    if (result.status === 'rejected') errors.push(result.reason);
  }
  for (const result of await Promise.allSettled([__testLspSessionPool.reset(), shutdownPythonAstPool(), shutdownTreeSitterWorkerPool()])) {
    if (result.status === 'rejected') errors.push(result.reason);
  }
  hooks.deregister(); delete globalThis.__runtimeScopePiscina;
  if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'Runtime scope proof or independent cleanup failed.', { cause: errors[0] });
}
assert.ok(logs.some(line => line.includes('preflight:') && /abort|error|fail/i.test(line)), 'expected owned-preflight cancellation is captured');
console.log(`Actual parser/LSP/preflight resources preserve overlapping run and host ownership: ${selected}.`);
