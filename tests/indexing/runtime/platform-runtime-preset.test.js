#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolvePlatformRuntimePreset, runStartupCalibrationProbe } from '../../../src/index/build/runtime/runtime.js';

applyTestEnv();

const winPreset = resolvePlatformRuntimePreset({
  platform: 'win32',
  filesystemProfile: 'ntfs',
  cpuCount: 8,
  indexingConfig: {}
});

assert.equal(winPreset.enabled, true, 'expected platform preset enabled by default');
assert.equal(winPreset.presetId, 'win32:ntfs', 'expected win32 preset id');
assert.equal(
  winPreset.subprocessFanout.maxParallelismHint,
  6,
  'expected win32 subprocess fanout preset to reserve startup headroom'
);
assert.equal(
  winPreset.overrides?.artifacts?.writeFsStrategy,
  'ntfs',
  'expected ntfs artifact strategy override'
);
assert.equal(
  winPreset.overrides?.scm?.maxConcurrentProcesses,
  6,
  'expected scm fanout override to follow subprocess preset'
);

const explicitPreset = resolvePlatformRuntimePreset({
  platform: 'win32',
  filesystemProfile: 'ntfs',
  cpuCount: 8,
  indexingConfig: {
    artifacts: { writeFsStrategy: 'generic' },
    scm: { maxConcurrentProcesses: 3 },
    scheduler: { writeBackpressure: { pendingBytesThreshold: 1234, oldestWaitMsThreshold: 55 } }
  }
});

assert.equal(explicitPreset.enabled, true, 'expected preset enabled with explicit config');
assert.equal(explicitPreset.overrides, null, 'expected no overrides when explicit values are present');

const disabledPreset = resolvePlatformRuntimePreset({
  platform: 'linux',
  filesystemProfile: 'posix',
  cpuCount: 12,
  indexingConfig: {
    platformPresets: { enabled: false }
  }
});

assert.equal(disabledPreset.enabled, false, 'expected preset to disable via config');
assert.equal(disabledPreset.presetId, 'disabled', 'expected disabled preset id');

const tempRoot = path.join(process.cwd(), '.testCache', 'platform-runtime-preset');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const probe = await runStartupCalibrationProbe({
  cacheRoot: tempRoot,
  enabled: true
});

assert.equal(probe.enabled, true, 'expected startup calibration probe to run');
assert.equal(probe.error ?? null, null, 'expected startup calibration probe to succeed');
assert.ok(probe.probeBytes > 0, 'expected probe bytes to be reported');
assert.ok(probe.writeReadMs >= 0, 'expected non-negative probe write/read timing');

const probePath = path.join(tempRoot, 'runtime-calibration', `probe-${process.pid}.tmp`);
assert.equal(fs.existsSync(probePath), false, 'expected startup probe temp file cleanup');

const disabledProbe = await runStartupCalibrationProbe({
  cacheRoot: tempRoot,
  enabled: false
});
assert.equal(disabledProbe.enabled, false, 'expected disabled startup probe to short-circuit');

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('platform runtime preset test passed');
