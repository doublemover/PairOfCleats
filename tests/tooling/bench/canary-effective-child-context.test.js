import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanaryRunnerPlan, createCanaryEnvironmentOwner, runCanaryVersionProbe } from '../../../tools/bench/language/canary-environment.js';
import { runBenchRuntimeLiveCanary } from '../../../tools/bench/language/canaries.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ extraEnv: { PAIROFCLEATS_THREADS: '1' } });
const root = process.cwd(), { dir } = await prepareTestCacheDir('canary-effective-child-context');
const script = path.join(root, 'tests/fixtures/bench-runtime-canaries/live/effective-child-context.js');
const cwdA = path.join(dir, 'cwd-a'), cwdB = path.join(dir, 'cwd-b'), trace = path.join(dir, 'trace.jsonl');
await fs.mkdir(cwdA); await fs.mkdir(cwdB);
const baseEnv = { ...process.env, PAIROFCLEATS_THREADS: '1', UNDECLARED_SECRET: 'never-serialize-canary-secret' };
const plan = overrides => createCanaryRunnerPlan({ cmd: process.execPath, args: [script], cwd: cwdA,
  parentEnv: baseEnv, overrides, workDir: path.join(dir, 'operation'), outJsonPath: path.join(dir, 'operation/result.json') });
const entry = { id: 'effective-context', environment: { os: 'cross-platform', toolchain: 'node only' } };
let probes = 0;
const injected = (probe, context) => {
  probes++;
  assert.equal(context.cwd, cwdA); assert.equal(context.env.PAIROFCLEATS_THREADS, '2');
  return { available: true, version: 'fixture-v1', exitCode: 0,
    runtime: probe.id === 'node' ? { nodeVersion: process.version, platform: process.platform, arch: process.arch } : null,
    accidentalEnvironment: context.env };
};
const selected = plan({ PAIROFCLEATS_THREADS: '2' }), owner = createCanaryEnvironmentOwner({ entry, plan: selected, probeRunner: injected });
const first = owner(); assert.equal(owner(), first); assert.equal(probes, 3, 'reuse belongs only to one exact immutable invocation');
assert.equal(first.actual.selected.PAIROFCLEATS_THREADS, '2'); assert.equal(first.parent.actual.selected.PAIROFCLEATS_THREADS, '1');
assert.equal(first.evidenceScope, 'injected-probe-contract'); assert.equal(first.comparisonFingerprint, null);
assert.equal(JSON.stringify({ selected, first }).includes(baseEnv.UNDECLARED_SECRET), false);
assert.throws(() => { selected.env.PAIROFCLEATS_THREADS = '9'; }, TypeError);
const pure = probe => ({ available: true, version: 'fixture-v1', exitCode: 0,
  runtime: probe.id === 'node' ? { nodeVersion: process.version, platform: process.platform, arch: process.arch } : null });
const reversed = createCanaryRunnerPlan({ cmd: process.execPath, args: [script], cwd: cwdA,
  parentEnv: Object.fromEntries(Object.entries(baseEnv).reverse()), overrides: { PAIROFCLEATS_THREADS: '2' },
  workDir: path.join(dir, 'operation'), outJsonPath: path.join(dir, 'operation/result.json') });
assert.equal(createCanaryEnvironmentOwner({ entry, plan: reversed, probeRunner: pure })().fingerprint, first.fingerprint);
assert.notEqual(createCanaryEnvironmentOwner({ entry, plan: plan({ PAIROFCLEATS_THREADS: '3' }), probeRunner: pure })().fingerprint, first.fingerprint);
const elsewhere = createCanaryRunnerPlan({ cmd: process.execPath, args: [script], cwd: cwdB,
  parentEnv: baseEnv, overrides: { PAIROFCLEATS_THREADS: '2' } });
assert.notEqual(createCanaryEnvironmentOwner({ entry, plan: elsewhere, probeRunner: pure })().fingerprint, first.fingerprint);
const operational = (name, suffix = '') => {
  const workDir = path.join(dir, name);
  const invocation = createCanaryRunnerPlan({ cmd: process.execPath, args: [script], cwd: workDir + suffix,
    workDir, outJsonPath: path.join(workDir, 'result.json'), parentEnv: baseEnv, overrides: { PAIROFCLEATS_THREADS: '2' } });
  return createCanaryEnvironmentOwner({ entry, plan: invocation, probeRunner: pure })().fingerprint;
};
assert.equal(operational('owned-a'), operational('owned-b'), 'only invocation-owned path coordinates normalize');
assert.notEqual(operational('owned-a', '-external'), operational('owned-b', '-external'), 'a matching string prefix cannot establish path ownership');
const unavailable = createCanaryEnvironmentOwner({ entry, plan: selected, probeRunner: () => ({ available: false, version: 'unverified', exitCode: null }) })();
assert.equal(unavailable.probes.node.version, null); assert.equal(unavailable.actual.nodeVersion, null); assert.equal(unavailable.comparisonFingerprint, null);

let refreshed = 0;
for (let i = 0; i < 2; i++) createCanaryEnvironmentOwner({ entry, plan: plan({ PAIROFCLEATS_THREADS: '2' }),
  probeRunner: probe => { refreshed++; return pure(probe); } })();
assert.equal(refreshed, 6, 'equivalent-looking new invocations reobserve local tool state');
const rust = createCanaryEnvironmentOwner({ entry: { environment: { toolchain: 'Rust/Cargo' } }, plan: selected, probeRunner: pure })();
assert.ok(rust.expectedProbeIds.includes('cargo')); assert.ok(!rust.expectedProbeIds.includes('go'), 'Cargo is not a Go toolchain hint');

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const bins = [];
for (const marker of ['a', 'b']) {
  const bin = path.join(marker === 'a' ? cwdA : cwdB, 'bin'); await fs.mkdir(bin); bins.push(bin);
  for (const name of ['go', 'gopls']) {
    const command = path.join(bin, name + (process.platform === 'win32' ? '.cmd' : ''));
    const text = process.platform === 'win32' ? `@echo off\r\nnode "${script}" --probe ${marker} %*\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} --probe ${marker} "$@"\n`;
    await fs.writeFile(command, text); if (process.platform !== 'win32') await fs.chmod(command, 0o755);
  }
}
const observed = [];
const execute = async (bin, threads, cwd) => {
  const previousThreads = process.env.PAIROFCLEATS_THREADS;
  try { return await runBenchRuntimeLiveCanary({ ...entry,
    environment: { os: 'cross-platform', toolchain: 'go', providerAvailability: 'synthetic fixture commands' },
    currentContract: { allowedResultClasses: ['passed'] }, targetContract: { allowedResultClasses: ['passed'] },
    runner: { type: 'script', script, cwd, args: ['--out', '{outJson}'], timeoutMs: 5000,
      env: { PATH: bin, PAIROFCLEATS_THREADS: threads, CANARY_CONTEXT_TRACE: trace, UNDECLARED_SECRET: baseEnv.UNDECLARED_SECRET } }
  }, root, { probeRunner: (probe, context) => {
    observed.push({ id: probe.id, cwd: context.cwd, threads: context.env.PAIROFCLEATS_THREADS });
    if (probe.id === 'node') process.env.PAIROFCLEATS_THREADS = '99';
    return runCanaryVersionProbe(probe, context);
  } }); } finally { process.env.PAIROFCLEATS_THREADS = previousThreads; }
};
const a = await execute('./bin', '2', cwdA), b = await execute('./bin', '3', cwdB);
const changedPath = await execute(bins[1], '2', cwdA);
assert.equal(changedPath.environment.probes.go.version, 'fixture-version-b');
assert.notEqual(changedPath.environment.fingerprint, a.environment.fingerprint);
assert.equal(a.ok, true); assert.equal(b.ok, true);
assert.equal(a.target.ok, true); assert.equal(a.environment.actual.nodeVersion, process.version);
assert.ok(a.environment.probes.go.execution.resolvedExecutable.startsWith(bins[0] + path.sep));
assert.ok(b.environment.probes.go.execution.resolvedExecutable.startsWith(bins[1] + path.sep));
assert.equal(a.environment.probes.go.version, 'fixture-version-a'); assert.equal(b.environment.probes.go.version, 'fixture-version-b');
assert.equal(a.environment.actual.selected.PAIROFCLEATS_THREADS, '2'); assert.equal(b.environment.actual.selected.PAIROFCLEATS_THREADS, '3');
assert.notEqual(a.environment.fingerprint, b.environment.fingerprint);
assert.equal(a.closureReady, false); assert.equal(a.environment.evidenceScope, 'injected-probe-contract');
assert.equal(JSON.stringify([a, b]).includes(baseEnv.UNDECLARED_SECRET), false);
const captured = (await fs.readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
for (const marker of ['a', 'b']) {
  const expectedCwd = marker === 'a' ? cwdA : cwdB, threads = marker === 'a' ? '2' : '3';
  assert.ok(captured.some(row => row.marker === marker && row.cwd === expectedCwd && row.threads === threads));
  assert.ok(captured.some(row => row.marker === 'child' && row.cwd === expectedCwd && row.threads === threads));
  assert.ok(observed.some(row => row.id === 'go' && row.cwd === expectedCwd && row.threads === threads));
}
console.log('Canary probes and real child execution share one immutable context, with private environment and invocation-scoped reuse.');
