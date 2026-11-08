import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { writePersistentCommandProbeCache, readPersistentCommandProbeCache,
  invalidatePersistentCommandProbeCache, createCommandProbeCacheKey,
  isOwnedCommandProbeCacheEntry } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { COMMAND_PROBE_POLICY_DEFAULTS } from '../../../src/contracts/schemas/storage-policy.js';

const temporary = await makeTempDir('poc-probe-write-admission-');
try {
  const base = { providerId: 'fixture', command: process.execPath, args: ['--version'], cwd: temporary,
    probeEnv: {}, toolingConfig: { cache: { dir: temporary } }, attempted: [{ ok: true }] };
  assert.equal(writePersistentCommandProbeCache(base), true);
  const directory = path.join(temporary, 'command-probes');
  const [name] = await fs.readdir(directory);
  const file = path.join(directory, name);
  const genuine = await fs.readFile(file);
  const pinned = { ...JSON.parse(genuine), pinned: true };
  await fs.writeFile(file, JSON.stringify(pinned));
  const protectedBytes = await fs.readFile(file);
  assert.equal(readPersistentCommandProbeCache(base)?.cached, true, 'read compatibility does not imply deletion or overwrite authority');
  assert.equal(writePersistentCommandProbeCache(base), false);
  assert.equal(invalidatePersistentCommandProbeCache(base), false);
  assert.deepEqual(await fs.readFile(file), protectedBytes);
  const saved = path.join(directory, 'saved-reference.json');
  await fs.writeFile(saved, 'unknown saved evidence');
  assert.equal(writePersistentCommandProbeCache({ ...base, args: ['--help'] }), false);
  assert.equal(await fs.readFile(saved, 'utf8'), 'unknown saved evidence');
  // A separate producer-owned category exercises hard count admission without
  // converting the protected category above into disposable data.
  const bounded = { ...base, toolingConfig: { cache: { dir: path.join(temporary, 'bounded') } } };
  const limit = COMMAND_PROBE_POLICY_DEFAULTS.entryLimit;
  assert.equal(limit, 256, 'the default count qualification is unchanged');
  assert.equal(writePersistentCommandProbeCache({ ...bounded, args: ['fixture-0'] }), true);
  const boundedDir = path.join(temporary, 'bounded', 'command-probes');
  const [firstName] = await fs.readdir(boundedDir);
  const prototype = JSON.parse(await fs.readFile(path.join(boundedDir, firstName), 'utf8'));
  await fs.utimes(path.join(boundedDir, firstName), new Date(0), new Date(0));
  // Intermediate below-limit writes repeat the same admission branch. Seed the
  // identical canonical records, prove every member's ownership and read path,
  // then execute the actual default-limit overflow through the public writer.
  for (let index = 1; index < limit; index += 1) {
    const payload = { ...prototype, args: [`fixture-${index}`] };
    const filename = `${createCommandProbeCacheKey(payload).digest}.json`;
    assert.equal(isOwnedCommandProbeCacheEntry(payload, filename), true);
    await fs.writeFile(path.join(boundedDir, filename), JSON.stringify(payload));
  }
  for (let index = 0; index < limit; index += 1) {
    assert.equal(readPersistentCommandProbeCache({ ...bounded, args: [`fixture-${index}`] })?.cached, true);
  }
  assert.equal((await fs.readdir(boundedDir)).length, limit);
  assert.equal(writePersistentCommandProbeCache({ ...bounded, args: [`fixture-${limit}`] }), true);
  assert.equal((await fs.readdir(boundedDir)).length, limit);
  assert.equal(readPersistentCommandProbeCache({ ...bounded, args: [`fixture-${limit}`] })?.cached, true);
  await assert.rejects(fs.lstat(path.join(boundedDir, firstName)), { code: 'ENOENT' });
  assert.equal(writePersistentCommandProbeCache({ ...bounded, attempted: [{ stdout: 'x'.repeat(8 * 1024 * 1024) }] }), false,
    'oversized payload cannot be written and pruned only afterward');
  assert.deepEqual(await fs.readFile(file), protectedBytes);
  assert.equal(await fs.readFile(saved, 'utf8'), 'unknown saved evidence');
} finally { await rmDirRecursive(temporary); }
console.log('probe write admission preserves unknown state passed');
