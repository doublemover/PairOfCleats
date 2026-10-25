import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';

const claimsUrl = new URL('../../../src/index/semantic/runtime/claims.js', import.meta.url).href;
const ownershipUrl = new URL('../../../src/index/semantic/runtime/ownership.js', import.meta.url).href;
const bridgeKey = '__runtimeClaimDeadlineFixture';
const gate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
let now = 0, admission = null, busy = null;
const admissions = [];
globalThis[bridgeKey] = { now: () => now, admit: async (options, operation, owner) => {
  const entry = { deadlineAt: options.checkAdmission.deadlineAt, beforeWait: options.remainingMs(), entered: false };
  admissions.push(entry);
  const barrier = admission; admission = null;
  if (barrier) { barrier.entered.resolve(); await barrier.release.promise; }
  entry.afterWait = options.remainingMs();
  return owner(options, async value => { entry.entered = true; return operation(value); });
} };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === claimsUrl && specifier === 'node:perf_hooks') return { url: 'claim-deadline:clock', shortCircuit: true };
    if (context.parentURL === claimsUrl && specifier === './ownership.js') return { url: 'claim-deadline:owner', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'claim-deadline:clock') return { format: 'module', shortCircuit: true,
      source: `export const performance={now:()=>globalThis.${bridgeKey}.now()};` };
    if (url === 'claim-deadline:owner') return { format: 'module', shortCircuit: true,
      source: `import {withRuntimeDestinationWriter as owner} from ${JSON.stringify(ownershipUrl)};
        export const withRuntimeDestinationWriter=(options,operation)=>globalThis.${bridgeKey}.admit(options,operation,owner);` };
    return next(url, context);
  }
});
const { withRuntimeDestinationWriter } = await import(ownershipUrl);
const { persistRuntimeDerivedClaims, runtimeClaimsBudget } = await import(claimsUrl);
const { compareRuntimeCaptures } = await import('../../../src/index/semantic/runtime/compare.js');
const { importRuntimeEvidence } = await import('../../../src/index/semantic/runtime/import.js');
const { createVerifiedRuntimeImportFixture } = await import('../../helpers/verified-runtime-import-fixture.js');
const { getRuntimeClaimPublication } = await import('../../../src/shared/runtime-claim-publication.js');
const { classifyRuntimeEvidenceError } = await import('../../../src/integrations/tooling/runtime-evidence.js');
const { formatToolError } = await import('../../../src/integrations/mcp/protocol.js');
const originalOpen = fs.open, originalRename = fs.rename, originalRm = fs.rm;
const pending = [], releases = [];
let fixture;
const contains = (error, expected) => {
  const queue = [error], seen = new Set();
  while (queue.length) {
    const value = queue.pop();
    if (value === expected) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); queue.push(value.cause, ...(value.errors || []));
  }
  return false;
};
try {
  fixture = await createVerifiedRuntimeImportFixture();
  const first = await importRuntimeEvidence(fixture.options());
  const options = fixture.options(); options.capture = structuredClone(fixture.capture);
  options.capture.captureId = 'capture-b'; options.capture.rawArtifacts.forEach(row => { row.captureId = 'capture-b'; });
  options.authority = { ...options.authority, captureId: 'capture-b' };
  const second = await importRuntimeEvidence(options), destination = options.destination;
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    leftFamily: first.pointer.generationId, rightFamily: second.pointer.generationId, sources: fixture.capture.sources,
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, persist: true };
  const baseline = await compareRuntimeCaptures({ destination, request });
  assert.equal(baseline.status, 'complete'); assert.ok(baseline.claimGeneration);
  const root = path.join(destination, 'claims'), pointerPath = path.join(root, 'current.json');
  const manifest = JSON.parse(await fs.readFile(path.join(root, baseline.claimGeneration, 'manifest.json')));
  const persist = (claims, signal = null, extra = {}) => persistRuntimeDerivedClaims({ destination, ...request,
    inputs: manifest.inputs, citations: manifest.citations, claims, signal, ...extra });
  const fresh = label => {
    const claims = structuredClone(baseline.claims);
    claims[0].evidenceId += ':' + label; claims[0].data.claim += ' Retained interpretation ' + label + '.';
    return claims;
  };
  const clean = async () => {
    assert.ok((await fs.readdir(root)).every(name => !name.startsWith('.pending-') && !name.startsWith('.current-')));
    await assert.rejects(fs.stat(path.join(destination, '.writer.lock')), { code: 'ENOENT' });
  };
  fs.open = async function (filename, ...args) {
    try { return await originalOpen.call(this, filename, ...args); }
    catch (error) {
      if (filename === path.join(destination, '.writer.lock') && error.code === 'EEXIST') busy?.resolve();
      throw error;
    }
  };
  for (const scenario of ['comparison', 'standalone', 'caller-cancel', 'healthy']) {
    const before = await fs.readFile(pointerPath), families = (await fs.readdir(root)).sort();
    const entered = gate(), release = gate(); releases.push(release.resolve);
    const holder = withRuntimeDestinationWriter({ destination, maxDiskWorkingSetBytes: null }, async () => {
      entered.resolve(); await release.promise;
    });
    pending.push(holder); holder.catch(() => {}); await entered.promise;
    const barrier = { entered: gate(), release: gate() }; admission = barrier; releases.push(barrier.release.resolve);
    busy = gate();
    const controller = new AbortController(), start = now;
    const operation = scenario === 'comparison'
      ? compareRuntimeCaptures({ destination, request, signal: controller.signal })
      : persist(baseline.claims, controller.signal);
    pending.push(operation); operation.catch(() => {});
    await barrier.entered.promise;
    const entry = admissions.at(-1);
    assert.equal(entry.deadlineAt, start + 1000);
    now += 400; barrier.release.resolve(); await busy.promise;
    assert.equal(entry.afterWait, 600, 'ownership receives remaining time, never a fresh allowance');
    if (scenario === 'caller-cancel') controller.abort();
    else if (scenario !== 'healthy') now += 601;
    release.resolve(); await holder;
    if (scenario === 'healthy') {
      assert.equal(await operation, baseline.claimGeneration);
      assert.equal(entry.entered, true);
    } else {
      await assert.rejects(operation, error => {
        assert.equal(error.code, scenario === 'caller-cancel' ? 'ABORT_ERR' : 'ERR_RUNTIME_QUERY_BUDGET');
        assert.equal(getRuntimeClaimPublication(error), null); return true;
      });
      assert.equal(entry.entered, false, 'expired ownership never enters claim mutation');
    }
    busy = null; await clean();
    assert.deepEqual(await fs.readFile(pointerPath), before);
    assert.deepEqual((await fs.readdir(root)).sort(), families);
  }
  const unique = fresh('deterministic');
  const generation = await persist(unique);
  assert.equal(await persist(unique), generation);
  assert.equal((await fs.readdir(root)).filter(name => name === generation).length, 1);
  const budget = runtimeClaimsBudget(request.limits);
  assert.equal(runtimeClaimsBudget(request.limits, budget.signal, budget), budget);
  await assert.rejects(persist(unique, null, { budget: () => {} }), /original operation budget/);
  assert.throws(() => runtimeClaimsBudget({ ...request.limits, maxMs: 999 }, budget.signal, budget), /original operation budget/);

  for (const scenario of ['promotion-expiry', 'commit-expiry', 'commit-cancel', 'commit-uncertain', 'cleanup-failure']) {
    const before = await fs.readFile(pointerPath), controller = new AbortController();
    const ioFailure = Object.freeze(Object.assign(new Error('actual replacement observation failed'), { code: 'EIO' }));
    const cleanupFailure = Object.freeze(new Error('owned pending cleanup failed'));
    let promoted = null, cleanupAttempts = 0;
    fs.rename = async function (from, to, ...args) {
      const result = await originalRename.call(this, from, to, ...args);
      if (path.dirname(to) === root && /^[a-f0-9]{64}$/.test(path.basename(to))) {
        promoted = path.basename(to);
        if (scenario === 'promotion-expiry' || scenario === 'cleanup-failure') now += 1001;
      }
      if (to === pointerPath) {
        if (scenario === 'commit-expiry') now += 1001;
        if (scenario === 'commit-cancel') controller.abort();
        if (scenario === 'commit-uncertain') throw ioFailure;
      }
      return result;
    };
    fs.rm = async function (filename, ...args) {
      const result = await originalRm.call(this, filename, ...args);
      if (path.dirname(filename) === root && path.basename(filename).startsWith('.pending-')) {
        cleanupAttempts++;
        if (scenario === 'cleanup-failure') throw cleanupFailure;
      } else if (path.dirname(filename) === root && path.basename(filename).startsWith('.current-')) cleanupAttempts++;
      return result;
    };
    try {
      await assert.rejects(persist(fresh(scenario), controller.signal), error => {
        assert.equal(error.code, scenario === 'commit-cancel' ? 'ABORT_ERR' : scenario === 'commit-uncertain' ? 'EIO' : 'ERR_RUNTIME_QUERY_BUDGET');
        const receipt = getRuntimeClaimPublication(error);
        assert.ok(receipt); assert.equal(receipt.claimGeneration, promoted);
        assert.equal(receipt.familyState, 'promoted');
        assert.equal(receipt.pointerState, scenario === 'promotion-expiry' || scenario === 'cleanup-failure' ? 'not-started'
          : scenario === 'commit-uncertain' ? 'commit-unconfirmed' : 'committed');
        assert.deepEqual(classifyRuntimeEvidenceError(error).runtimeClaimPublication, receipt);
        assert.deepEqual(formatToolError(error).details.runtimeClaimPublication, receipt);
        assert.equal(formatToolError(error).nativeCode, error.code);
        if (scenario === 'commit-uncertain') assert.ok(contains(error, ioFailure));
        if (scenario === 'cleanup-failure') assert.ok(contains(error, cleanupFailure));
        return true;
      });
    } finally { fs.rename = originalRename; fs.rm = originalRm; }
    assert.equal(cleanupAttempts, 2, 'both independent staging removals are attempted');
    const published = JSON.parse(await fs.readFile(pointerPath));
    if (scenario === 'promotion-expiry' || scenario === 'cleanup-failure') assert.deepEqual(await fs.readFile(pointerPath), before);
    else assert.equal(published.claimGeneration, promoted);
    const actualManifest = await fs.readFile(path.join(root, promoted, 'manifest.json'));
    assert.equal(JSON.parse(actualManifest).claimGeneration, promoted, 'promoted immutable family survives failure');
    if (published.claimGeneration === promoted) {
      const { runtimeByteHash } = await import('../../../src/index/semantic/runtime/raw-store.js');
      assert.equal(published.manifestHash, runtimeByteHash(actualManifest));
    }
    await clean();
  }
  const forged = Object.assign(new Error('forged'), { runtimeClaimPublication: { claimGeneration: generation } });
  assert.equal(getRuntimeClaimPublication(forged), null);
  assert.equal(classifyRuntimeEvidenceError(forged).runtimeClaimPublication, undefined);
  assert.equal(formatToolError(forged).details?.runtimeClaimPublication, undefined);
  console.log('runtime comparison deadline, owned cleanup and publication reconciliation passed');
} finally {
  releases.forEach(release => release());
  fs.rename = originalRename; fs.rm = originalRm; fs.open = originalOpen;
  await Promise.allSettled(pending);
  hooks.deregister(); delete globalThis[bridgeKey];
  if (fixture) await fixture.cleanup();
}
