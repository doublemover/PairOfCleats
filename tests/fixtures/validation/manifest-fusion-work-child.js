import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs/promises');
const path = (await import('node:path')).default;
const { performance } = await import('node:perf_hooks');
const { prepareIsolatedTestCacheDir } = await import('../../helpers/test-cache.js');
const { ensureTestingEnv } = await import('../../helpers/test-env.js');
const { loadValidationArm, observeValidationReads } = await import('../../helpers/validation-read-observation.js');
const { seedValidationWorkFixture, validationDigest } = await import('../../helpers/validation-work-fixture.js');
ensureTestingEnv(process.env);
const [scope, arm, trial] = process.argv.slice(2);
assert.ok(['small', 'jsonl', 'multipart', 'warm'].includes(scope));
assert.ok(['fused', 'eager'].includes(arm)); assert.ok(['1', '2', '3'].includes(trial));
assert.equal(typeof global.gc, 'function');
const { dir } = await prepareIsolatedTestCacheDir('validation-work-' + scope + '-' + arm + '-' + trial);
let observation;
try {
  const fixture = await seedValidationWorkFixture(dir, { layout: scope === 'multipart' ? 'sharded' : 'jsonl',
    rows: scope === 'small' ? 8 : 512, paddingBytes: scope === 'small' ? 128 : 8192 });
  const measured = await loadValidationArm(arm), control = await loadValidationArm(arm === 'fused' ? 'eager' : 'fused');
  // The cold scopes measure the first validator invocation. Warm alone performs
  // explicit untimed full parity/warmup before its three fresh-content passes.
  if (scope === 'warm') {
    const preflight = await control(fixture.input), warmed = await measured(fixture.input);
    assert.equal(preflight.ok, true, JSON.stringify(preflight)); assert.deepEqual(warmed, preflight);
    await measured(fixture.input);
  }
  global.gc(); global.gc();
  observation = observeValidationReads(fixture.indexDir);
  const memoryBefore = process.memoryUsage(), cpuBefore = process.cpuUsage(), start = performance.now();
  let report;
  const repetitions = scope === 'warm' ? 3 : 1;
  for (let index = 0; index < repetitions; index++) report = await measured(fixture.input);
  const wallMs = performance.now() - start, cpuMicroseconds = process.cpuUsage(cpuBefore), memoryAfter = process.memoryUsage();
  const maxRssKiB = process.resourceUsage().maxRSS;
  observation.stop();
  const expected = await control(fixture.input);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report, expected);
  for (const relative of fixture.chunkPaths) {
    const work = observation.metrics.files[relative], bytes = fixture.inventory.find(row => row.path === relative).bytes;
    const passes = repetitions * (arm === 'fused' ? 1 : 2);
    assert.equal(work.opens, passes, relative + ' selected checksum/decode descriptor count');
    assert.equal(work.bytesRead, bytes * passes, relative + ' actual stored-byte work');
  }
  assert.equal(observation.metrics.files['audit-opaque.bin'].bytesRead, 5 * repetitions, 'every unconsumed binary remains checksummed on every invocation');
  const backendProjection = backend => {
    const value = report[backend];
    assert.equal(value.code, report.selection[backend + 'Paths'].code);
    assert.equal(value.prose, null);
    const relative = path.relative(fixture.indexRoot, value.code);
    assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    return { ...value, code: relative.replaceAll(path.sep, '/') };
  };
  const projection = { ok: report.ok, strict: report.strict, code: { ...report.modes.code, path: '<index-code>' },
    sqlite: backendProjection('sqlite'), lmdb: backendProjection('lmdb'), issues: report.issues, warnings: report.warnings,
    hints: report.hints, findings: report.findings, orderingDrift: report.orderingDrift };
  assert.equal(report.root, process.platform === 'win32' ? fixture.repoRoot.toLowerCase() : fixture.repoRoot); assert.equal(report.indexRoot, fixture.indexRoot);
  assert.equal(report.modes.code.path, fixture.indexDir);
  global.gc();
  console.log(JSON.stringify({ measurement: 'full-validator-manifest-integrity-work', scope, arm, trial: Number(trial),
    node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch,
    inputDigest: fixture.inputDigest, outputProjection: projection, outputDigest: validationDigest(JSON.stringify(projection)),
    completeSameRootReportParity: true, firstValidation: scope !== 'warm', inventory: fixture.inventory, repetitions, work: observation.metrics,
    wallMs, cpuMicroseconds, memoryBefore, memoryAfter, memoryAfterCollection: process.memoryUsage(), maxRssKiB,
    cacheState: 'Fresh process and generated page-cache-warm bytes. Small/jsonl/multipart measure the first validation; warm performs explicit untimed parity/warmup then three independent full validations.',
    scopeLimit: 'Full strict production validator over canonical synthetic index artifacts; excludes indexing/build time and device-cold storage. Heap is sampled; RSS includes preparation and any explicit warmup; heap is sampled at real read boundaries. Cross-process digest projects explicitly asserted mode/backend root fields only after complete same-root report parity.' }));
} finally { observation?.stop(); await fs.rm(dir, { recursive: true, force: true }); }
