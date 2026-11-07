import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createRepoCacheManager } from '../../../src/shared/repo-cache-config.js';
import { createRepoCacheManager as createApiManager } from '../../../tools/api/router/cache.js';
import { resolveRepoPath } from '../../../tools/mcp/repo.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';

const nativeKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const observeIo = operation => {
  const keys = ['openSync', 'readSync', 'fstatSync', 'closeSync', 'statSync', 'lstatSync', 'existsSync'];
  const originals = Object.fromEntries(keys.map(key => [key, fs[key]]));
  const work = Object.fromEntries(keys.map(key => [key, 0]));
  work.configOpens = {}; work.configReads = 0; work.configReadBytes = 0;
  work.liveDescriptors = 0; work.peakLiveDescriptors = 0;
  const descriptors = new Map();
  for (const key of keys) fs[key] = (...args) => {
    work[key]++;
    const result = originals[key].call(fs, ...args);
    if (key === 'openSync') {
      const filename = String(args[0]); descriptors.set(result, filename); work.liveDescriptors++;
      work.peakLiveDescriptors = Math.max(work.peakLiveDescriptors, work.liveDescriptors);
      if (path.basename(filename) === '.pairofcleats.json') work.configOpens[filename] = (work.configOpens[filename] || 0) + 1;
    } else if (key === 'readSync' && path.basename(descriptors.get(args[0]) || '') === '.pairofcleats.json') {
      work.configReads++; work.configReadBytes += result;
    } else if (key === 'closeSync' && descriptors.delete(args[0])) work.liveDescriptors--;
    return result;
  };
  try { return { result: operation(), work }; }
  finally {
    for (const key of keys) fs[key] = originals[key];
    assert.equal(work.liveDescriptors, 0, 'all original clean config descriptors close');
  }
};

export const runScenario = async ({ destination }) => {
  const fixture = path.join(destination, 'probe-input'), repo = path.join(fixture, 'repo');
  const nested = path.join(repo, 'nested'), cache = path.join(fixture, 'cache');
  await fsp.mkdir(fixture); await fsp.mkdir(nested, { recursive: true });
  const env = applyTestEnv({ cacheRoot: cache, syncProcess: false, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const observations = [];
  try {
    await fsp.writeFile(path.join(repo, '.pairofcleats.json'), '{}');
    await fsp.writeFile(path.join(nested, '.pairofcleats.json'), '{}');
    execFileSync('git', ['init', '-q'], { cwd: repo, windowsHide: true, stdio: 'ignore' });
    return await withTemporaryEnv({ PAIROFCLEATS_TESTING: env.PAIROFCLEATS_TESTING,
      PAIROFCLEATS_CACHE_ROOT: cache, PAIROFCLEATS_TEST_CONFIG: env.PAIROFCLEATS_TEST_CONFIG ?? null,
      PAIROFCLEATS_TRUSTED_CONFIG: null }, async () => {
      const roots = [repo, nested].map(root => getRepoCacheRoot(root, loadUserConfig(root)));
      for (const root of roots) {
        const relative = path.relative(cache, root);
        assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      }
      assert.notEqual(nativeKey(roots[0]), nativeKey(roots[1]));
      for (const [combination, parentPresent, childPresent] of [
        ['none', false, false], ['parent-only', true, false], ['child-only', false, true], ['both', true, true]
      ]) {
        for (const [index, present] of [parentPresent, childPresent].entries()) {
          const indexDir = path.join(roots[index], 'index-code');
          if (present) await fsp.mkdir(indexDir, { recursive: true });
          else await fsp.rm(indexDir, { recursive: true, force: true });
        }
        for (const surface of ['shared', 'api', 'mcp']) {
          const manager = surface === 'mcp' ? null
            : (surface === 'api' ? createApiManager : createRepoCacheManager)({ defaultRepo: repo });
          try {
            const resolve = candidate => manager ? manager.getRepoCaches(candidate) : resolveRepoPath(candidate);
            const pathOf = result => manager ? result.repoRoot : result;
            for (const [location, candidate] of [['root', repo], ['nested', nested]]) {
              const expected = location === 'root' ? repo
                : surface === 'mcp' ? parentPresent ? repo : childPresent ? nested : repo
                  : childPresent ? nested : repo;
              const cpu = process.cpuUsage(), start = performance.now(), first = resolve(candidate);
              const coldWallMs = performance.now() - start, coldCpu = process.cpuUsage(cpu);
              assert.equal(nativeKey(pathOf(first)), nativeKey(expected));
              const cleanSamples = [];
              for (let trial = 0; trial < 8; trial++) {
                const cpuStart = process.cpuUsage(), wallStart = performance.now(), result = resolve(candidate);
                const wallMs = performance.now() - wallStart, used = process.cpuUsage(cpuStart);
                assert.equal(nativeKey(pathOf(result)), nativeKey(expected));
                if (manager) assert.equal(result, first, 'hot requests preserve the actual cache entry object');
                cleanSamples.push({ wallMs, cpuUserMicros: used.user, cpuSystemMicros: used.system });
              }
              const allocation = await observeHeapAllocations({ destination,
                name: `probe-${combination}-${surface}-${location}`, iterations: 4, operation: () => resolve(candidate) });
              const { result, work } = observeIo(() => resolve(candidate));
              assert.equal(nativeKey(pathOf(result)), nativeKey(expected));
              if (manager) assert.equal(result, first);
              observations.push({ combination, surface, location, expectedRoot: expected,
                cacheEntryIdentity: manager ? 'same original object across all hot requests' : 'not-a-cache-manager',
                firstRequest: { wallMs: coldWallMs, cpuUserMicros: coldCpu.user, cpuSystemMicros: coldCpu.system,
                  scope: 'first request at this location;the preceding root request may already have admitted the selected entry' },
                cleanSamples, allocation, work });
            }
          } finally {
            if (manager) {
              assert.equal(manager.closeRepoCaches().status, 'settled');
              assert.equal((await manager.awaitRepoRetirement()).status, 'settled');
            }
          }
        }
      }
      return { issue: 1763, platform: process.platform, observations,
        scope: 'actual Git/config/artifact selection;clean timings separate from original config descriptor/stat counts;hot probes may read config' };
    });
  } finally { await fsp.rm(fixture, { recursive: true, force: true }); }
};
