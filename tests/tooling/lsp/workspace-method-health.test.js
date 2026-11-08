import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspaceMethodHealth } from '../../../src/integrations/tooling/providers/lsp/workspace-method-health.js';
import { createToolingGuard } from '../../../src/integrations/tooling/providers/shared.js';
import { isTimeoutError } from '../../../src/integrations/tooling/providers/lsp/hover-types/stages.js';
import { LSP_SHORT_QUARANTINE_MS, LSP_EXTENDED_QUARANTINE_MS } from '../../../src/integrations/tooling/providers/lsp/health-policy.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { sleep } from '../../../src/shared/sleep.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { getWorkspaceHealthDecision } from '../../../src/integrations/tooling/providers/lsp/workspace-health-decision.js';

// UNVALIDATED: actual shared health/cache/guard/lock owners. The process cases
// use fresh inert Node children, never a language-server, compiler or model.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['cross-process', 'source-change', 'config-change', 'runtime-change', 'policy-change', 'root-independence',
  'method-independence', 'cooldown-probe', 'concurrent-probe', 'transport', 'malformed', 'corrupt-preserved',
  'unknown-identity', 'pending-owner', 'settled-failure', 'ordinary-retry', 'healthy-reset', 'variant-bound',
  'negative-config', 'cancelled', 'write-failure', 'collector-processes', 'collector-same-process', 'code-only-timeout',
  'protocol-malformed', 'spoofed-decision', 'foreign-preserved', 'future-state-preserved', 'clock-bound'].includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir(`workspace-method-health-${selected}`);
const tool = path.join(root, 'inert-runtime.exe'); await fs.writeFile(tool, 'inert runtime bytes, never launched');
const text = 'function greet(name) return name end\n'; await fs.writeFile(path.join(root, 'source.lua'), text);
const documents = [{ virtualPath: 'source.lua', text, languageId: 'lua' }];
let clock = Date.parse('2026-10-28T10:00:00Z'), settled = false, probeChild, passed = false;
const childObservations = [];
const options = { repoRoot: root, workspaceRoot: root, providerId: 'fixture-lua-health', workspaceKey: 'fixture-workspace',
  providerVersion: '1', command: tool, args: [], environment: { FIXTURE: 'stable' }, documents,
  initializationOptions: null, configFileNames: ['.luarc.json'], policy: { fixture: true },
  cacheRoot: path.join(root, 'cache'), timeoutThreshold: 1, now: () => clock };
const timeout = Object.assign(new Error('LSP request timeout'), { code: 'ERR_LSP_REQUEST_TIMEOUT' });
const run = (owner, method, operation, retries = 2) => createToolingGuard({ name: 'fixture-workspace', retries, breakerThreshold: 3 })
  .run(parameters => owner.run(method, operation, { retriesRemaining: parameters.retriesRemaining }), { label: method });
const record = async (owner, error = timeout) => {
  let calls = 0;
  await assert.rejects(run(owner, 'hover', () => { calls++; throw error; }));
  assert.equal(calls, 1, 'quarantined actual failure cannot repeat under the generic retry allowance');
};
const filename = owner => path.join(options.cacheRoot, 'lsp', 'workspace-health', owner.identity.scopeKey + '.json');
const child = phase => spawnSubprocess(process.execPath, [fileURLToPath(new URL('./fixtures/workspace-health-process.js', import.meta.url)),
  root, phase, String(clock)], { cwd: root, env: { ...process.env }, timeoutMs: 5000, maxOutputBytes: 32768,
  rejectOnNonZeroExit: true, killTree: true }).then(result => {
  const original = observeStorageResource(result, { phase: 'workspace-health-fixture-child' }); original.requireSettled();
  return JSON.parse(result.stdout);
}, error => { childObservations.push(observeStorageResource(error, { phase: 'workspace-health-fixture-child-failure' })); throw error; });
const open = fs.open;
try {
  if (selected === 'clock-bound') {
    await assert.rejects(createWorkspaceMethodHealth({ ...options, now: () => Number.MAX_SAFE_INTEGER }), TypeError);
  } else if (selected === 'collector-same-process') {
    const output = await child('collector-same-process'); assert.equal(output.requests['textDocument/hover'], 1);
    assert.equal(output.requests['textDocument/documentSymbol'], 2);
  } else if (selected === 'collector-processes') {
    const first = await child('collector-record'), second = await child('collector-reuse');
    assert.equal(first.requests['textDocument/hover'], 1); assert.equal(second.requests['textDocument/hover'] || 0, 0);
    assert.equal(second.requests['textDocument/documentSymbol'], 1);
  } else if (['cross-process', 'cooldown-probe', 'concurrent-probe'].includes(selected)) {
    const first = await child('record'); assert.equal(first.calls, 1);
    const second = await child('reuse'); assert.equal(second.metrics.byMethod.hover.reusedHealth, true);
    if (selected !== 'cross-process') {
      clock += LSP_SHORT_QUARANTINE_MS + 1;
      if (selected === 'concurrent-probe') {
        probeChild = child('probe-gate'); probeChild.catch(() => {});
        const started = Date.now();
        for (;;) {
          try { await fs.stat(path.join(root, 'probe-ready')); break; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (Date.now() - started > 2500) throw new Error('First controlled probe did not reach its bounded gate.');
          await sleep(10);
        }
        const competing = await child('probe'); assert.equal(competing.calls, 0);
        await fs.writeFile(path.join(root, 'probe-release'), 'release'); assert.equal((await probeChild).calls, 1);
      } else assert.equal((await child('probe')).calls, 1);
      const recovered = await createWorkspaceMethodHealth(options); assert.equal(recovered.suppressBeforeAdmission('hover'), false);
    }
  } else {
    let owner = await createWorkspaceMethodHealth(options);
    assert.match(owner.identity.fingerprint, /^[a-f0-9]{64}$/u);
    if (['source-change', 'config-change', 'runtime-change', 'policy-change', 'root-independence', 'negative-config'].includes(selected)) {
      await record(owner); const previous = owner.identity.fingerprint;
      if (selected === 'source-change') documents[0].text = text + '-- repaired source';
      if (selected === 'config-change' || selected === 'negative-config') await fs.writeFile(path.join(root, '.luarc.json'), '{"Lua":{"diagnostics":{"enable":false}}}');
      if (selected === 'runtime-change') await fs.writeFile(tool, 'repaired runtime with the same claimed version');
      if (selected === 'policy-change') options.policy = { fixture: true, changed: true };
      if (selected === 'root-independence') { const other = path.join(root, 'other'); await fs.mkdir(other); options.repoRoot = other; options.workspaceRoot = other; }
      const changed = await createWorkspaceMethodHealth(options);
      assert.notEqual(changed.identity.fingerprint, previous); assert.equal(changed.suppressBeforeAdmission('hover'), false);
      let calls = 0; await run(changed, 'hover', () => { calls++; return null; }); assert.equal(calls, 1);
    } else if (selected === 'method-independence') {
      await record(owner); let calls = 0;
      assert.deepEqual(await run(owner, 'documentSymbol', () => { calls++; return []; }), []); assert.equal(calls, 1);
      assert.equal(owner.suppressBeforeAdmission('hover'), true); assert.equal(owner.suppressBeforeAdmission('documentSymbol'), false);
    } else if (selected === 'protocol-malformed') {
      const protocol = Object.assign(new Error('invalid JSON-RPC envelope'), { code: 'ERR_LSP_PROTOCOL_ENVELOPE' });
      await assert.rejects(run(owner, 'hover', () => { throw protocol; }), error => {
        assert.equal(getWorkspaceHealthDecision(error)?.methodScoped, false); return errorGraphIncludes(error, protocol);
      });
      assert.equal(owner.metrics().byMethod.hover.lastFailureClass, 'malformed');
    } else if (selected === 'spoofed-decision') {
      let calls = 0;
      const spoofed = Object.assign(new Error('server supplied lookalike admission fields'), { code: 'TOOLING_METHOD_COOLDOWN', methodScoped: true });
      await assert.rejects(run(owner, 'hover', () => { calls++; throw spoofed; }, 1), error => error === spoofed);
      assert.equal(calls, 2); assert.equal(getWorkspaceHealthDecision(spoofed), null);
    } else if (selected === 'transport' || selected === 'malformed') {
      if (selected === 'transport') await record(owner, Object.assign(new Error('LSP transport closed'), { code: 'ERR_LSP_TRANSPORT_CLOSED' }));
      else await assert.rejects(run(owner, 'hover', () => ({ wrong: 'malformed response' })), { code: 'ERR_LSP_HEALTH_MALFORMED_RESPONSE' });
      const read = JSON.parse(await fs.readFile(filename(owner), 'utf8'));
      const state = read.variants[owner.identity.fingerprint].methods.hover;
      assert.equal(state.failureClass, selected); assert.equal(state.cooldownUntil, clock + LSP_EXTENDED_QUARANTINE_MS);
    } else if (['corrupt-preserved', 'foreign-preserved', 'future-state-preserved'].includes(selected)) {
      await record(owner); const file = filename(owner);
      let preserved = '{not valid health';
      if (selected !== 'corrupt-preserved') {
        const value = JSON.parse(await fs.readFile(file, 'utf8'));
        if (selected === 'foreign-preserved') value.variants[owner.identity.fingerprint].methods.hover.unknownField = 'foreign state';
        else { const state = value.variants[owner.identity.fingerprint].methods.hover;
          state.updatedAt = clock + 86400000; state.cooldownUntil = state.updatedAt + LSP_SHORT_QUARANTINE_MS; }
        preserved = JSON.stringify(value);
      }
      await fs.writeFile(file, preserved);
      owner = await createWorkspaceMethodHealth(options); assert.equal(owner.metrics().persistedState, 'unavailable');
      assert.equal(owner.suppressBeforeAdmission('hover'), false); await record(owner);
      assert.equal(await fs.readFile(file, 'utf8'), preserved); assert.equal(owner.metrics().publishedWrites, 0);
    } else if (selected === 'unknown-identity') {
      owner = await createWorkspaceMethodHealth({ ...options, documents: [{ virtualPath: 'source.lua' }] });
      assert.equal(owner.identity.fingerprint, null); await record(owner);
      assert.equal(owner.metrics().persistedState, 'disabled');
      await assert.rejects(fs.stat(path.join(options.cacheRoot, 'lsp', 'workspace-health')), { code: 'ENOENT' });
    } else if (selected === 'pending-owner') {
      const pending = Object.freeze(Object.assign(new Error('original request still owns work'), { code: 'ERR_LSP_REQUEST_TIMEOUT',
        cacheOwnershipReleased: () => settled }));
      let calls = 0, failure;
      const guard = createToolingGuard({ name: 'pending-method-health', retries: 2 });
      await assert.rejects(guard.run(() => owner.run('hover', () => { calls++; throw pending; }), { label: 'hover' }), error => { failure = error; return errorGraphIncludes(error, pending); });
      assert.equal(calls, 1); assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(owner.metrics().publishedWrites, 0);
      await assert.rejects(guard.run(() => { calls++; })); assert.equal(calls, 1);
      settled = true; assert.deepEqual(await guard.run(() => owner.run('documentSymbol', () => []), { label: 'documentSymbol' }), []);
    } else if (selected === 'code-only-timeout') {
      const expired = Object.assign(new Error('request deadline expired'), { code: 'ERR_LSP_REQUEST_TIMEOUT' });
      assert.equal(isTimeoutError(expired), true); await record(owner, expired);
      assert.equal(owner.metrics().byMethod.hover.lastFailureClass, 'timeout');
    } else if (selected === 'settled-failure') {
      await record(owner, Object.freeze(Object.assign(new Error('LSP request timeout'), { code: 'ERR_LSP_REQUEST_TIMEOUT', cacheOwnershipReleased: () => true })));
      assert.equal(owner.metrics().publishedWrites, 1);
    } else if (selected === 'ordinary-retry') {
      let calls = 0;
      assert.equal(await run(owner, 'hover', () => { if (++calls === 1) throw new Error('ordinary request failure'); return null; }, 1), null);
      assert.equal(calls, 2); assert.equal(owner.metrics().publishedWrites, 0);
    } else if (selected === 'healthy-reset') {
      options.timeoutThreshold = 3; owner = await createWorkspaceMethodHealth(options);
      await assert.rejects(run(owner, 'hover', () => { throw timeout; }, 0));
      assert.equal(owner.suppressBeforeAdmission('hover'), false);
      await run(owner, 'hover', () => null);
      const later = await createWorkspaceMethodHealth(options);
      await assert.rejects(run(later, 'hover', () => { throw timeout; }, 0));
      const read = JSON.parse(await fs.readFile(filename(later), 'utf8'));
      assert.equal(read.variants[later.identity.fingerprint].methods.hover.failures, 1);
    } else if (selected === 'variant-bound') {
      for (let i = 0; i < 10; i++) { owner = await createWorkspaceMethodHealth({ ...options, policy: { fixture: true, variant: i } }); await record(owner); }
      const read = JSON.parse(await fs.readFile(filename(owner), 'utf8'));
      assert.equal(Object.keys(read.variants).length, 8); assert.ok(read.variants[owner.identity.fingerprint]);
    } else if (selected === 'cancelled') {
      let calls = 0;
      await assert.rejects(run(owner, 'hover', () => { calls++; throw Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORT_ERR' }); }), { name: 'AbortError' });
      assert.equal(calls, 1); assert.equal(owner.metrics().publishedWrites, 0);
    } else if (selected === 'write-failure') {
      const injected = Object.freeze(Object.assign(new Error('independent health receipt write failure'), { code: 'ERR_FIXTURE_HEALTH_WRITE' }));
      const parent = path.dirname(filename(owner)); let calls = 0;
      fs.open = async (file, flags, ...args) => {
        if (String(file).startsWith(parent + path.sep) && String(flags).includes('w') && !String(file).endsWith('.lock')) throw injected;
        return open(file, flags, ...args);
      };
      await assert.rejects(run(owner, 'hover', () => { calls++; throw timeout; }), error => errorGraphIncludes(error, timeout) && errorGraphIncludes(error, injected));
      assert.equal(calls, 1); assert.equal(owner.metrics().persistenceFailures, 1);
    }
  }
  passed = true;
} finally {
  settled = true; fs.open = open;
  await fs.writeFile(path.join(root, 'probe-release'), 'release'); await probeChild?.catch(() => {});
  if (passed) {
    for (const original of childObservations) original.requireSettled();
    assert.ok(path.resolve(root).startsWith(path.resolve(path.dirname(root)) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
}
console.log(`Workspace method health: ${selected}`);
