#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { parseBuildArgs } from '../../../src/index/build/args.js';
import { createBuildRuntime } from '../../../src/index/build/runtime.js';
import { resolveDispatchRuntimeEnv } from '../../../bin/dispatch-runtime-env.js';
import { resolveTuiWrapperEnv } from '../../../bin/tui-wrapper-env.js';
import { planShardBatches } from '../../../src/index/build/shards.js';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope/resolve.js';
import { resolveThreadLimits } from '../../../src/shared/threads.js';
import { runNode } from '../../helpers/run-node.js';
import { repoRoot } from '../../helpers/root.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { resolveRuntimeEnv } from '../../../tools/shared/dict-utils.js';

const cases = [
  {
    name: 'node options and max-old-space honor config but respect external NODE_OPTIONS',
    run() {
      const baseEnv = { ...process.env };
      delete baseEnv.NODE_OPTIONS;
      delete baseEnv.PAIROFCLEATS_NODE_OPTIONS;
      delete baseEnv.PAIROFCLEATS_MAX_OLD_SPACE_MB;

      const request = resolveRuntimeEnvelope({
        argv: {},
        rawArgv: [],
        userConfig: { runtime: { nodeOptions: '--trace-warnings', maxOldSpaceMb: 2048 } },
        env: baseEnv,
        cpuCount: 4,
        toolVersion: 'test'
      });
      const patch = request.envPatch.nodeOptions;
      assert.ok(patch);
      assert.ok(patch.includes('--trace-warnings'));
      assert.ok(patch.includes('--max-old-space-size=2048'));

      const externalOverride = resolveRuntimeEnvelope({
        argv: {},
        rawArgv: [],
        userConfig: { runtime: { nodeOptions: '--trace-warnings', maxOldSpaceMb: 2048 } },
        env: { ...baseEnv, NODE_OPTIONS: '--max-old-space-size=1024 --trace-warnings' },
        cpuCount: 4,
        toolVersion: 'test'
      });
      assert.ok(!externalOverride.envPatch.nodeOptions);
      assert.equal(externalOverride.runtime.maxOldSpaceMb.effective.value, 1024);
    }
  },
  {
    name: 'uv threadpool precedence resolves defaults config and env overrides consistently',
    run() {
      const baseEnv = { ...process.env };
      delete baseEnv.UV_THREADPOOL_SIZE;
      delete baseEnv.PAIROFCLEATS_UV_THREADPOOL_SIZE;

      const baseline = resolveRuntimeEnvelope({
        argv: {},
        rawArgv: [],
        userConfig: {},
        env: baseEnv,
        cpuCount: 4,
        toolVersion: 'test'
      });
      assert.equal(baseline.runtime.uvThreadpoolSize.effective.value, 4);
      assert.equal(baseline.envPatch.set.UV_THREADPOOL_SIZE, '4');

      const configRequest = resolveRuntimeEnvelope({
        argv: {},
        rawArgv: [],
        userConfig: { runtime: { uvThreadpoolSize: 8 } },
        env: baseEnv,
        cpuCount: 4,
        toolVersion: 'test'
      });
      assert.equal(configRequest.runtime.uvThreadpoolSize.effective.value, 8);
      assert.equal(configRequest.envPatch.set.UV_THREADPOOL_SIZE, '8');

      const externalOverride = resolveRuntimeEnvelope({
        argv: {},
        rawArgv: [],
        userConfig: { runtime: { uvThreadpoolSize: 8 } },
        env: { ...baseEnv, UV_THREADPOOL_SIZE: '6' },
        cpuCount: 4,
        toolVersion: 'test'
      });
      assert.equal(externalOverride.runtime.uvThreadpoolSize.effective.value, 6);
      assert.ok(!externalOverride.envPatch.set.UV_THREADPOOL_SIZE);

      const envResolved = resolveRuntimeEnv({ uvThreadpoolSize: 8 }, { ...process.env, UV_THREADPOOL_SIZE: undefined });
      assert.equal(envResolved.UV_THREADPOOL_SIZE, '8');
      const noOverrideResolved = resolveRuntimeEnv({ uvThreadpoolSize: 8 }, { ...process.env, UV_THREADPOOL_SIZE: '4' });
      assert.equal(noOverrideResolved.UV_THREADPOOL_SIZE, '4');
    }
  },
  {
    name: 'wrapper spawn env preserves runtime overrides and external node options precedence',
    run() {
      const root = repoRoot();
      const wrapperPath = path.join(root, 'bin', 'pairofcleats.js');
      const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
      const buildEnv = (overrides) => {
        const env = { ...process.env, ...overrides };
        delete env.UV_THREADPOOL_SIZE;
        delete env.NODE_OPTIONS;
        delete env.PAIROFCLEATS_NODE_OPTIONS;
        return ensureTestingEnv(env);
      };
      const runDump = (env) => {
        const result = runNode([
          wrapperPath,
          'index',
          '--config-dump',
          '--repo',
          fixtureRoot
        ], 'wrapper config dump', root, env, { stdio: 'pipe', allowFailure: true });
        assert.strictEqual(result.status, 0, `wrapper config dump exited with ${result.status}: ${result.stderr || ''}`);
        const output = String(result.stdout || '').trim();
        assert.ok(output);
        return JSON.parse(output);
      };
      const patched = runDump(buildEnv({
        PAIROFCLEATS_UV_THREADPOOL_SIZE: '7',
        PAIROFCLEATS_MAX_OLD_SPACE_MB: '2048'
      }));
      assert.strictEqual(patched.runtime.uvThreadpoolSize.effective.source, 'external-env');
      assert.strictEqual(patched.runtime.maxOldSpaceMb.effective.source, 'external-env');
      const preserved = runDump({
        ...buildEnv({
          PAIROFCLEATS_UV_THREADPOOL_SIZE: '7',
          PAIROFCLEATS_MAX_OLD_SPACE_MB: '2048'
        }),
        NODE_OPTIONS: '--trace-warnings'
      });
      assert.strictEqual(preserved.runtime.nodeOptions.effective.source, 'external-env');
      assert.ok(preserved.runtime.nodeOptions.effective.value?.includes('--trace-warnings'));
      assert.strictEqual(preserved.runtime.maxOldSpaceMb.effective.value, null);
    }
  },
  {
    name: 'dispatch runtime env keeps repo-configured runtime tuning for heavy commands',
    async run() {
      const root = process.cwd();
      const tempRoot = resolveTestCachePath(root, 'dispatch-runtime-env');
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
      await fsPromises.mkdir(tempRoot, { recursive: true });
      await fsPromises.writeFile(path.join(tempRoot, '.pairofcleats.json'), JSON.stringify({
        runtime: {
          nodeOptions: '--trace-warnings',
          maxOldSpaceMb: 1536,
          uvThreadpoolSize: 9
        }
      }, null, 2));

      const baseEnv = { ...process.env };
      delete baseEnv.NODE_OPTIONS;
      delete baseEnv.UV_THREADPOOL_SIZE;
      delete baseEnv.PAIROFCLEATS_NODE_OPTIONS;
      delete baseEnv.PAIROFCLEATS_MAX_OLD_SPACE_MB;
      delete baseEnv.PAIROFCLEATS_UV_THREADPOOL_SIZE;

      const heavyEnv = await resolveDispatchRuntimeEnv({
        root: tempRoot,
        scriptPath: 'tools/reports/throughput.js',
        baseEnv
      });
      assert.equal(heavyEnv.UV_THREADPOOL_SIZE, '9');
      assert.match(String(heavyEnv.NODE_OPTIONS || ''), /--trace-warnings/);
      assert.match(String(heavyEnv.NODE_OPTIONS || ''), /--max-old-space-size=1536/);

      const skippedEnv = await resolveDispatchRuntimeEnv({
        root: tempRoot,
        scriptPath: 'tools/index/cli-entry.js',
        baseEnv
      });
      assert.equal(skippedEnv.UV_THREADPOOL_SIZE, '9');
      assert.match(String(skippedEnv.NODE_OPTIONS || ''), /--max-old-space-size=1536/);
    }
  },
  {
    name: 'tui wrapper env layers tui variables over dispatch runtime baseline',
    async run() {
      const root = process.cwd();
      const tempRoot = resolveTestCachePath(root, 'tui-dispatch-runtime-env');
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
      await fsPromises.mkdir(tempRoot, { recursive: true });
      await fsPromises.writeFile(path.join(tempRoot, '.pairofcleats.json'), JSON.stringify({
        runtime: {
          nodeOptions: '--trace-warnings',
          maxOldSpaceMb: 1408,
          uvThreadpoolSize: 10
        }
      }, null, 2));

      const baseEnv = { ...process.env };
      delete baseEnv.NODE_OPTIONS;
      delete baseEnv.UV_THREADPOOL_SIZE;
      delete baseEnv.PAIROFCLEATS_NODE_OPTIONS;
      delete baseEnv.PAIROFCLEATS_MAX_OLD_SPACE_MB;
      delete baseEnv.PAIROFCLEATS_UV_THREADPOOL_SIZE;

      const env = await resolveTuiWrapperEnv({
        runtimeRoot: tempRoot,
        tuiEnvConfig: {
          runId: 'configured-run',
          installRoot: path.join(tempRoot, 'configured-install'),
          eventLogDir: path.join(tempRoot, 'configured-logs')
        },
        installRoot: path.join(tempRoot, 'fallback-install'),
        eventLogDir: path.join(tempRoot, 'fallback-logs'),
        baseEnv,
        runId: 'fallback-run'
      });
      assert.equal(env.UV_THREADPOOL_SIZE, '10');
      assert.match(String(env.NODE_OPTIONS || ''), /--trace-warnings/);
      assert.match(String(env.NODE_OPTIONS || ''), /--max-old-space-size=1408/);
      assert.equal(env.PAIROFCLEATS_TUI_RUN_ID, 'configured-run');
      assert.equal(env.PAIROFCLEATS_TUI_INSTALL_ROOT, path.join(tempRoot, 'configured-install'));
      assert.equal(env.PAIROFCLEATS_TUI_EVENT_LOG_DIR, path.join(tempRoot, 'configured-logs'));

      const fallbackEnv = await resolveTuiWrapperEnv({
        runtimeRoot: tempRoot,
        tuiEnvConfig: {},
        installRoot: path.join(tempRoot, 'fallback-install'),
        eventLogDir: path.join(tempRoot, 'fallback-logs'),
        baseEnv,
        runId: 'fallback-run'
      });
      assert.equal(fallbackEnv.PAIROFCLEATS_TUI_RUN_ID, 'fallback-run');
      assert.equal(fallbackEnv.PAIROFCLEATS_TUI_INSTALL_ROOT, path.join(tempRoot, 'fallback-install'));
      assert.equal(fallbackEnv.PAIROFCLEATS_TUI_EVENT_LOG_DIR, path.join(tempRoot, 'fallback-logs'));
    }
  },
  {
    name: 'thread limit precedence and shard planning stay balanced',
    run() {
      const cliResult = resolveThreadLimits({
        argv: { threads: 8 },
        rawArgv: ['--threads', '8'],
        envConfig: { threads: 4 },
        cpuCount: 16
      });
      assert.equal(cliResult.threads, 8);
      assert.equal(cliResult.source, 'cli');

      const configResult = resolveThreadLimits({
        argv: {},
        rawArgv: [],
        envConfig: { threads: 4 },
        configConcurrency: 6,
        configConcurrencySource: 'config.indexing.concurrency',
        configSourceTag: 'config',
        cpuCount: 16
      });
      assert.equal(configResult.threads, 6);
      assert.equal(configResult.source, 'config');

      const limits = resolveThreadLimits({
        argv: { threads: 4 },
        rawArgv: ['--threads', '4'],
        envConfig: {},
        configConcurrency: null,
        importConcurrencyConfig: null,
        cpuCount: 8,
        uvThreadpoolSize: 4
      });
      assert.equal(limits.fileConcurrency, 8);
      assert.equal(limits.cpuConcurrency, limits.threads);

      const items = [
        { id: 'a', weight: 8 },
        { id: 'b', weight: 7 },
        { id: 'c', weight: 6 },
        { id: 'd', weight: 5 }
      ];
      const batches = planShardBatches(items, 2, { resolveWeight: (item) => item.weight });
      const sums = batches.map((batch) => batch.reduce((sum, item) => sum + item.weight, 0)).sort((a, b) => b - a);
      assert.deepEqual(sums, [13, 13]);
    }
  },
  {
    name: 'build runtime preserves records configuration shape',
    async run() {
      const root = process.cwd();
      const tempRoot = resolveTestCachePath(root, 'runtime-records-config');
      const repoDir = path.join(tempRoot, 'repo');
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
      await fsPromises.mkdir(repoDir, { recursive: true });
      ensureTestingEnv(process.env);
      process.env.PAIROFCLEATS_CACHE_ROOT = tempRoot;
      process.env.PAIROFCLEATS_EMBEDDINGS = 'off';
      process.env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify({
        indexing: {
          scm: { provider: 'none' },
          embeddings: {
            enabled: false,
            hnsw: { enabled: false },
            lancedb: { enabled: false }
          }
        }
      });
      const defaults = parseBuildArgs([]).argv;
      const runtime = await createBuildRuntime({ root: repoDir, argv: defaults, rawArgv: [] });
      assert.ok(Object.prototype.hasOwnProperty.call(runtime, 'recordsDir'));
      assert.ok(Object.prototype.hasOwnProperty.call(runtime, 'recordsConfig'));
      delete process.env.PAIROFCLEATS_TEST_CONFIG;
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('shared runtime contract matrix test passed');
