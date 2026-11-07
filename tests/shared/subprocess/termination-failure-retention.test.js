import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--isolated-tree-rejection')) {
  const { runNode } = await import('../../helpers/run-node.js');
  const preload = `--import ${new URL('../../helpers/test-env.js', import.meta.url).href}`;
  const env = { ...process.env, NODE_OPTIONS: String(process.env.NODE_OPTIONS || '').replaceAll(preload, '').trim() };
  const result = runNode([fileURLToPath(import.meta.url), '--isolated-tree-rejection'],
    'owned tree cleanup rejection', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 1);
}
const original = Object.freeze(new Error('controlled original native tree rejection'));
const state = { child: null, calls: 0, error: original };
globalThis.__ownedTreeRejection = state;
const actual = new URL('../../../src/shared/kill-tree.js', import.meta.url).href;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('/kill-tree.js') && context.parentURL?.endsWith('/subprocess/tracking-terminate.js')) {
    return { url: 'termination-failure:kill', shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url !== 'termination-failure:kill') return next(url, context);
  return { format: 'module', shortCircuit: true, source: `import * as actual from ${JSON.stringify(actual)};
    export * from ${JSON.stringify(actual)};
    const reject = child => {const state=globalThis.__ownedTreeRejection;
      if(child===state.child){state.calls++;throw state.error;}};
    export const killChildProcessTree = async (child,options) => {reject(child);return actual.killChildProcessTree(child,options);};
    export const killChildProcessTreeSync = (child,options) => {reject(child);return actual.killChildProcessTreeSync(child,options);};` };
} });
const { registerChildProcessForCleanup, terminateTrackedSubprocesses, terminateTrackedSubprocessesSync,
  getTrackedSubprocessCount } = await import('../../../src/shared/subprocess/tracking.js');
const { assertSubprocessTerminationReceipt } = await import('../../../src/shared/subprocess/termination-receipt.js');
const { errorGraphIncludes } = await import('../../helpers/error-graph.js');
const owner = `termination-rejection:${process.pid}`;
const child = state.child = spawn(process.execPath, ['-e',
  "process.stdin.on('data',()=>process.exit(0));process.stdout.write('ready');"], { stdio: ['pipe', 'pipe', 'pipe'] });
const closed = once(child, 'close');
const unregister = registerChildProcessForCleanup(child, { ownershipId: owner, killTree: true });
try {
  await once(child.stdout, 'data');
  const receipts = [terminateTrackedSubprocessesSync({ ownershipId: owner }),
    await terminateTrackedSubprocesses({ ownershipId: owner })];
  const failures = receipts.map(receipt => {
    assert.equal(receipt.failures, 1); assert.equal(receipt.killAudit[0].closeObserved, false);
    let failure;
    assert.throws(() => assertSubprocessTerminationReceipt(receipt), error => { failure = error; return true; });
    assert.ok(errorGraphIncludes(failure, original), 'the original frozen native rejection survives report validation');
    assert.equal(failure.cacheOwnershipReleased(), false);
    receipt.failures = 0; receipt.killAudit[0].error = null; receipt.killAudit[0].terminated = true; receipt.killAudit[0].closeObserved = true;
    assert.equal(failure.cacheOwnershipReleased(), false, 'public audit edits cannot settle the original tree failure');
    return failure;
  });
  assert.equal(getTrackedSubprocessCount(owner), 1);
  child.stdin.end('quit'); await closed; await Promise.resolve();
  assert.equal(getTrackedSubprocessCount(owner), 0);
  for (const failure of failures) assert.equal(failure.cacheOwnershipReleased(), false,
    'actual direct-child close cannot erase rejected tree cleanup');
  assert.equal(state.calls, 2, 'late observation does not retry tree termination');
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.stdin.end('quit'); await closed; }
  unregister(); hook.deregister(); delete globalThis.__ownedTreeRejection;
}
console.log('Original async/sync tree rejection remains owned after direct close and audit edits.');
