import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { writePersistentCommandProbeCache, readPersistentCommandProbeCache,
  invalidatePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';

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
  for (let index = 0; index < 257; index += 1) assert.equal(writePersistentCommandProbeCache({ ...bounded, args: [`fixture-${index}`] }), true);
  assert.equal((await fs.readdir(path.join(temporary, 'bounded', 'command-probes'))).length, 256);
  assert.equal(writePersistentCommandProbeCache({ ...bounded, attempted: [{ stdout: 'x'.repeat(8 * 1024 * 1024) }] }), false,
    'oversized payload cannot be written and pruned only afterward');
  assert.deepEqual(await fs.readFile(file), protectedBytes);
  assert.equal(await fs.readFile(saved, 'utf8'), 'unknown saved evidence');
} finally { await rmDirRecursive(temporary); }
console.log('probe write admission preserves unknown state passed');
